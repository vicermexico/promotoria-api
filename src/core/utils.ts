import dotenv from "dotenv";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

import { RowDataPacket } from "mysql2/promise";
import { EmailService } from "./services/email/EmailService";

import db from "../config/database";
import { Database } from "./database";
// import { taskNotificationsQueue } from "./bullmq/task-notifications.queue";
// import { TASK_NOTIF_QUEUE_NAME } from "./bullmq/task-notifications.queue";
import { prisma } from "./prisma";


dotenv.config();
function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET
  if (!secret || secret.length < 32) throw new Error("Falta JWT_SECRET (minimo 32 caracteres) en el .env")
  return secret
}

export interface TokenPayload {
  id: number;
  email: string;
  id_client: number;
  i_rol: number;
}

interface TokenPromoterPayload {
  id: number
  phone: string
  email?: string
}

export function generarCodigoAfiliacion(): string {
  const caracteres = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let codigo = "";
  for (let i = 0; i < 6; i++) {
    codigo += caracteres.charAt(Math.floor(Math.random() * caracteres.length));
  }
  
  return codigo;
}

interface GeocodingResult {
  latitude: number | null;
  longitude: number | null;
  formatted_address?: string;
}

interface ClientRow extends RowDataPacket {
  vc_initialism: string;
}

interface FolioRow extends RowDataPacket {
  id_folio: number;
  i_folio?: number;
}

// Opciones adicionales de contexto para todos los logs
export interface LogOptions {
  id_promotor?: number; // 0 si la acción la hizo un usuario admin, número si fue un promotor
  id_negocio?: number;  // id_client del contexto del negocio, 0 si no aplica
  id_pais?: number;     // id del país de contexto, 0 si no aplica
}

export class Utils {
  static db: Database = db;


  static async hash_password(password_unsecured: string): Promise<string> {
    try {
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(password_unsecured, saltRounds);
      return hashedPassword;
    } catch (error) {
      console.error("Error al hashear la contraseña:", error);
      throw error;
    }
  }


  static async compare_password( password_unsecured: string, password_hashed: string ): Promise<boolean> {
    try {
      const isMatch = await bcrypt.compare(password_unsecured, password_hashed);
      return isMatch;
    } catch (error) {
      console.error("Error al comparar contraseñas:", error);
      throw error;
    }
  }


  static generate_token(payload: TokenPayload | TokenPromoterPayload, _expiresIn: string = "30d"): string {
    return jwt.sign(payload, getJwtSecret(), {
      expiresIn: "30d",
    });
  }

  // Token de larga duración (90 días) que sirve solo para pedir un token de
  // acceso nuevo cuando el actual expira. Se distingue con type:'refresh'.
  static generate_refresh_token(payload: TokenPayload | TokenPromoterPayload): string {
    return jwt.sign({ ...payload, type: 'refresh' }, getJwtSecret(), {
      expiresIn: "90d",
    });
  }

  static verify_token(token: string): Promise<TokenPayload> {
    return new Promise((resolve, reject) => {
      jwt.verify(token, getJwtSecret(), (err, decoded) => {
        if (err) {
          reject(err);
        } else {
          resolve(decoded as TokenPayload);
        }
      });
    });
  }

  /**
   * Envía un email usando el proveedor actual del EmailService
   * @param to - Destinatario(s) del email
   * @param subject - Asunto del email
   * @param html - Contenido HTML del email
   * @param text - Contenido en texto plano (opcional)
   * @returns Promise<boolean> - true si el email se envió correctamente
   */
  static async sendEmail(
    to: string | string[],
    subject: string,
    html: string,
    text?: string,
  ): Promise<boolean> {
    try {
      const emailService = new EmailService();

      const result = await emailService.send({
        to,
        subject,
        html,
        text,
      });

      if (!result.success) {
        console.error(`Error al enviar email: ${result.error}`);
        return false;
      }

      console.log(`Email enviado con ${result.provider}: ${result.messageId}`);
      return true;
    } catch (error) {
      console.error("Error al enviar email:", error);
      return false;
    }
  }

  static async geocodeAddress(address: string): Promise<GeocodingResult> {
    try {
      const apiKey = process.env.GOOGLE_MAPS_API_KEY;
      const encodedAddress = encodeURIComponent(address);
      
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedAddress}&key=${apiKey}`;
      
      const response = await fetch(url);
      const data = await response.json();

      if (data.status === "OK" && data.results.length > 0) {
        const location = data.results[0].geometry.location;
        return {
          latitude: location.lat,
          longitude: location.lng,
          formatted_address: data.results[0].formatted_address
        };
      }

      console.log("Geocoding no encontró resultados para:", address);
      return { latitude: null, longitude: null };

    } catch (error) {
      console.error("Error en geocoding:", error);
      return { latitude: null, longitude: null };
    }
  }

  static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Obtiene el siguiente folio disponible SIN crear registro
   * Solo consulta cuál sería el siguiente número
  */
  static async getCurrentFolio(id_client: number, i_type: number = 1): Promise<string> {
    try {
      const getClient = "SELECT vc_initialism FROM clients WHERE id_client = ? LIMIT 1";
      const clientRows = await this.db.select<ClientRow[]>(getClient, [id_client]);
      
      if (!clientRows || clientRows.length === 0) {
        throw new Error(`Client ${id_client} not found`);
      }

      const initialism = clientRows[0].vc_initialism;

      // Obtener el ÚLTIMO folio registrado para este cliente/tipo
      const getLastFolio = `
        SELECT i_folio 
        FROM folios 
        WHERE id_client = ? AND i_type = ? 
        ORDER BY i_folio DESC 
        LIMIT 1
      `;
      const lastFolioRows = await this.db.select<FolioRow[]>(getLastFolio, [id_client, i_type]);

      let nextFolio: number;

      if (!lastFolioRows || lastFolioRows.length === 0) {
        // Si no existe ningún folio, el siguiente será 1
        nextFolio = 1;
      } else {
        // El siguiente es el último + 1
        nextFolio = lastFolioRows[0].i_folio! + 1;
      }

      const formattedFolio = `${initialism}${String(nextFolio).padStart(5, '0')}`;
      return formattedFolio;

    } catch (error) {
      console.error("Error getting current folio:", error);
      throw error;
    }
  }

  /**
   * Registra/inserta un nuevo folio usado en la base de datos
   * Cada ticket tendrá su propio registro en la tabla folios
  */
  static async updateFolioCounter(id_client: number, i_type: number = 1): Promise<number> {
    try {
      const getLastFolio = `SELECT i_folio FROM folios WHERE id_client = ? AND i_type = ? ORDER BY i_folio DESC LIMIT 1`;
      const lastFolioRows = await this.db.select<FolioRow[]>(getLastFolio, [id_client, i_type]);

      let newFolioNumber: number;

      if (!lastFolioRows || lastFolioRows.length === 0) {
        newFolioNumber = 1;
      } else {
        newFolioNumber = lastFolioRows[0].i_folio! + 1;
      }

      const insertFolio = `INSERT INTO folios (id_client, i_type, i_folio, i_before_folio, i_next_folio) VALUES (?, ?, ?, ?, ?)`;
      await this.db.execute(insertFolio, [
        id_client, 
        i_type, 
        newFolioNumber,
        newFolioNumber - 1,
        newFolioNumber + 1
      ]);

      return newFolioNumber;

    } catch (error) {
      console.error("Error inserting folio record:", error);
      throw error;
    }
  }

  // static async add_job_to_process_task_notificacions_queue(taskId: number): Promise<void> {
  //   try {
  //     await taskNotificationsQueue.add("send_task_notification", { taskId });
  //     console.log(`Job added to ${TASK_NOTIF_QUEUE_NAME} queue for task ${taskId}`);
  //   } catch (error) {
  //     console.error("Error adding job to queue:", error);
  //     throw error;
  //   }
  // }

  static async getCountriesList(){
    return await prisma.countries.findMany({
      where: { is_active: true }
    })
  }

  static async getStatesList(id_country: number){
    return await prisma.states.findMany({
      where: { id_country, is_active: true }
    })
  }

  static async getCitiesList(id_state: number){
    return await prisma.cities.findMany({
      where: { id_state, is_active: true }
    })
  }
}
