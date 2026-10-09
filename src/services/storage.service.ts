import { Storage } from "@google-cloud/storage";
import sharp from "sharp";
import * as fs from "fs";
import * as path from "path";
import { randomBytes } from "crypto";

import { prisma } from "../core/prisma";

/**
 * StorageService — fuente única para subir recursos al bucket (GCS).
 *
 * Política NO-DESTRUCTIVA: cada subida genera una key única (nunca colisiona),
 * se guarda en el bucket sin borrar nada, y se registra en la tabla `assets`.
 * La versión vigente queda `is_active = true` y las anteriores `is_active = false`.
 * Nunca se sobreescribe ni se borra un archivo de cliente.
 *
 * Convención de paths:
 *   clients/{id_client}/{entidad}/{entity_id}/{[folio_][extraRef_]}{timestamp}-{rand}.{ext}
 * Si no hay id_client (p.ej. task_answer), se omite el prefijo `clients/{id_client}`.
 */

const keyPath = path.resolve(process.cwd(), "keys/gcp-service-account.json");
const credentials = JSON.parse(fs.readFileSync(keyPath, "utf-8"));

const storage = new Storage({
  projectId: process.env.GCP_PROJECT_ID,
  credentials,
});

const bucket = storage.bucket(process.env.GCP_BUCKET_NAME!);

export type AssetEntity =
  | "product"
  | "product_barcode"
  | "request"
  | "sale_channel"
  | "task_answer"
  | "task_arrangement"
  | "client_doc"
  | "client_logo"
  | "promoter"
  | "client_charge"
  | "client_charge_order"
  | "promoter_payment"
  | "app_config"
  | "task_preorder_signature"
  | "task_arrangement_after";

const ENTITY_SEGMENT: Record<AssetEntity, string> = {
  product: "products",
  product_barcode: "product_barcodes",
  request: "requests",
  sale_channel: "sale_channels",
  task_answer: "task_answers",
  task_arrangement: "task_arrangements",
  client_doc: "docs",
  client_logo: "client_logos",
  promoter: "promoters",
  client_charge: "client_charges",
  client_charge_order: "client_charge_orders",
  promoter_payment: "promoter_payments",
  app_config: "app_config",
  task_preorder_signature: "task_preorder_signatures",
  task_arrangement_after: "task_arrangements_after",
};

interface OptimizeOpts {
  maxW: number;
  maxH: number;
  quality?: number;
}

const DEFAULT_OPTIMIZE: OptimizeOpts = { maxW: 1200, maxH: 1200, quality: 80 };

export interface UploadAssetInput {
  entity: AssetEntity;
  entity_id: number;
  buffer: Buffer;
  mime: string;
  id_client?: number | null;
  /** Folio de negocio si la entidad lo tiene; se usa en el nombre del archivo. */
  folio?: string | null;
  id_user?: number | null;
  /** Nombre original (para documentos, conserva el nombre legible). */
  originalName?: string;
  /** Referencia extra dentro del nombre (p.ej. id_request_product_question). */
  extraRef?: string | number;
  /**
   * Optimización de imagen con sharp → webp. `true` (default) usa los valores
   * por defecto, un objeto los personaliza, `false` sube el archivo tal cual
   * (para documentos PDF/Excel, etc.).
   */
  optimize?: boolean | OptimizeOpts;
}

export interface UploadAssetResult {
  url: string;
  path: string;
  id_asset: number;
  vc_folio: string;
}

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60);
}

export class StorageService {
  /**
   * Sube un archivo al bucket de forma no-destructiva y lo registra en `assets`.
   */
  static async uploadAsset(input: UploadAssetInput): Promise<UploadAssetResult> {
    const optimize = input.optimize ?? true;
    const isImage = input.mime.startsWith("image/");
    const shouldOptimize = optimize !== false && isImage;

    let bodyBuffer = input.buffer;
    let contentType = input.mime;
    let ext: string;

    if (shouldOptimize) {
      const opts = optimize === true ? DEFAULT_OPTIMIZE : optimize;
      bodyBuffer = await sharp(input.buffer)
        .rotate() // Auto-orienta segun el EXIF de la foto (las fotos de celular
        // vienen "acostadas" con una etiqueta de rotacion; sin esto, sharp
        // achica la imagen tal cual viene y se ve girada al mostrarla).
        .webp({ quality: opts.quality ?? 80 })
        .resize(opts.maxW, opts.maxH, { fit: "inside", withoutEnlargement: true })
        .toBuffer();
      contentType = "image/webp";
      ext = "webp";
    } else {
      ext = (path.extname(input.originalName ?? "").replace(".", "") || mimeToExt(input.mime) || "bin").toLowerCase();
    }

    const objectPath = StorageService.buildKey(input, ext);
    const file = bucket.file(objectPath);

    await file.save(bodyBuffer, {
      metadata: {
        contentType,
        cacheControl: "public, max-age=31536000",
      },
    });

    const url = `https://storage.googleapis.com/${process.env.GCP_BUCKET_NAME}/${objectPath}`;

    // Registro no-destructivo: marca la versión anterior como inactiva e inserta la nueva.
    const { id_asset, vc_folio } = await prisma.$transaction(async (tx) => {
      await tx.assets.updateMany({
        where: {
          entity_type: input.entity,
          entity_id: input.entity_id,
          is_active: true,
        },
        data: { is_active: false },
      });

      const created = await tx.assets.create({
        data: {
          id_client: input.id_client ?? null,
          entity_type: input.entity,
          entity_id: input.entity_id,
          bucket_path: objectPath,
          vc_url: url,
          vc_mime: contentType,
          i_size: bodyBuffer.length,
          id_user: input.id_user ?? null,
          is_active: true,
        },
        select: { id_asset: true },
      });

      const assetFolio = `AST-${created.id_asset.toString().padStart(8, '0')}`;
      await tx.assets.update({
        where: { id_asset: created.id_asset },
        data: { vc_folio: assetFolio },
      });

      return { id_asset: created.id_asset, vc_folio: assetFolio };
    });

    return { url, path: objectPath, id_asset, vc_folio };
  }

  /**
   * Sube un archivo tal cual (sin optimizar, sin registrar en `assets`) a una
   * ruta arbitraria del bucket. Para features con su propia tabla de control
   * (ej. clips de video de intro_video_clips), donde la semántica de
   * "una sola version activa por entidad" de uploadAsset() no aplica porque
   * puede haber varios archivos vigentes a la vez para la misma entidad.
   */
  static async uploadRawFile(buffer: Buffer, mime: string, objectPath: string): Promise<{ url: string, path: string }> {
    const file = bucket.file(objectPath);
    await file.save(buffer, {
      metadata: {
        contentType: mime,
        cacheControl: "public, max-age=31536000",
      },
    });
    const url = `https://storage.googleapis.com/${process.env.GCP_BUCKET_NAME}/${objectPath}`;
    return { url, path: objectPath };
  }

  /** Borra un objeto del bucket. No truena si ya no existe. */
  static async deleteRawFile(objectPath: string): Promise<void> {
    try {
      await bucket.file(objectPath).delete();
    } catch (error: any) {
      if (error?.code !== 404) throw error;
    }
  }

  private static buildKey(input: UploadAssetInput, ext: string): string {
    const segment = ENTITY_SEGMENT[input.entity];
    const prefix = input.id_client ? `clients/${input.id_client}/` : "";

    const parts: string[] = [];
    if (input.folio) parts.push(slugify(String(input.folio)));
    if (input.extraRef !== undefined) parts.push(slugify(String(input.extraRef)));
    if (input.originalName && !input.mime.startsWith("image/")) {
      const base = path.basename(input.originalName, path.extname(input.originalName));
      parts.push(slugify(base));
    }
    const rand = randomBytes(3).toString("hex");
    parts.push(`${Date.now()}-${rand}`);

    const fileName = `${parts.join("_")}.${ext}`;
    return `${prefix}${segment}/${input.entity_id}/${fileName}`;
  }
}

function mimeToExt(mime: string): string | null {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.ms-excel": "xls",
  };
  return map[mime] ?? null;
}
