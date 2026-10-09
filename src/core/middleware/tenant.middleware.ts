import { Request, Response, NextFunction, Router } from "express";
import { Utils } from "../utils";

// Pasar a true cuando el log [TENANT] confirme que el panel no cruza datos entre clientes.
export const TENANT_BLOQUEAR = true;
const ROL_ADMIN = 2;

async function usuarioDe(req: Request): Promise<any | null> {
  if ((req as any).user) return (req as any).user;
  const h = req.headers.authorization;
  if (!h || !h.startsWith("Bearer ")) return null;
  try {
    return await Utils.verify_token(h.split(" ")[1]);
  } catch {
    return null;
  }
}

// Solo aplica a usuarios del panel de cliente (rol ADMIN, token sin phone).
function esDeOtroCliente(user: any, valor: unknown): boolean {
  if (!user || user.phone || user.i_rol !== ROL_ADMIN) return false;
  if (valor === undefined || valor === null || valor === "") return false;
  return String(valor) !== String(user.id_client);
}

function responder(req: Request, res: Response, user: any, valor: unknown, donde: string): boolean {
  const ruta = String(req.originalUrl).split("?")[0].replace(/\/\d+/g, "/:n");
  console.warn(`[TENANT] ${donde} user=${user?.id} suyo=${user?.id_client} pidio=${valor} ${req.method} ${ruta}`);
  if (TENANT_BLOQUEAR) {
    res.status(403).json({ ok: false, data: null, message: "No tienes permiso para ver datos de otro negocio" });
    return true;
  }
  return false;
}

// Revisa rutas con :id_client en la URL.
export const tenantParam = async (req: Request, res: Response, next: NextFunction, valor: string) => {
  try {
    const user = await usuarioDe(req);
    if (esDeOtroCliente(user, valor) && responder(req, res, user, valor, "param")) return;
  } catch (e) {
    console.error("[TENANT] error", e);
  }
  next();
};

export const aplicarTenant = (router: Router) => {
  router.param("id_client", tenantParam);
};

// Revisa id_client que llegue en query o en body.
export const tenantQueryBody = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await usuarioDe(req);
    const q = (req.query as any)?.id_client;
    const b = (req.body as any)?.id_client;
    for (const [valor, donde] of [[q, "query"], [b, "body"]] as const) {
      if (esDeOtroCliente(user, valor) && responder(req, res, user, valor, donde)) return;
    }
  } catch (e) {
    console.error("[TENANT] error", e);
  }
  next();
};

// ---------- Paso 2: recursos pedidos por su numero (producto, orden, tarea...) ----------
import { prisma } from "../prisma";

// Pasar a true cuando el log [TENANT-REC] salga limpio.
export const RECURSOS_BLOQUEAR = true;

const RECURSOS: Record<string, { modelo: string; pk: string }> = {
  id_product: { modelo: "products", pk: "id_product" },
  id_order: { modelo: "orders", pk: "id_order" },
  id_task: { modelo: "tasks", pk: "id_task" },
  id_driver: { modelo: "drivers", pk: "id_driver" },
  id_route: { modelo: "delivery_routes", pk: "id_route" },
  id_route_template: { modelo: "route_templates", pk: "id_route_template" },
  id_schedule: { modelo: "route_driver_schedules", pk: "id_schedule" },
  id_request: { modelo: "requests", pk: "id_request" },
  id_question_client: { modelo: "questions_client", pk: "id_question_client" },
  id_store_client: { modelo: "client_stores", pk: "id_client_store" },
  id_charge: { modelo: "client_charges", pk: "id_charge" },
};

const paramRecurso = (nombre: string) => async (req: Request, res: Response, next: NextFunction, valor: string) => {
  try {
    const user = await usuarioDe(req);
    if (user && !user.phone && user.i_rol === ROL_ADMIN) {
      const n = Number(valor);
      if (Number.isInteger(n) && n > 0) {
        const { modelo, pk } = RECURSOS[nombre];
        const fila = await (prisma as any)[modelo].findFirst({ where: { [pk]: n }, select: { id_client: true } });
        if (fila && String(fila.id_client) !== String(user.id_client)) {
          const ruta = String(req.originalUrl).split("?")[0].replace(/\/\d+/g, "/:n");
          console.warn(`[TENANT-REC] ${nombre} user=${user.id} suyo=${user.id_client} dueno=${fila.id_client} ${req.method} ${ruta}`);
          if (RECURSOS_BLOQUEAR) {
            res.status(403).json({ ok: false, data: null, message: "No tienes permiso para acceder a este recurso" });
            return;
          }
        }
      }
    }
  } catch (e) {
    console.error("[TENANT-REC] error", e);
  }
  next();
};

export const aplicarTenantRecursos = (router: Router) => {
  for (const nombre of Object.keys(RECURSOS)) router.param(nombre, paramRecurso(nombre));
};

// ---------- Paso 3: listas "dame todo" -> se fuerza el filtro al cliente del usuario ----------
const LISTAS_PROPIAS = /^\/(tasks|orders|requests)\/?$|^\/stock\/map\/?$/;

export const forzarMiCliente = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    if (req.method === "GET" && LISTAS_PROPIAS.test(req.path)) {
      const user = await usuarioDe(req);
      if (user && !user.phone && user.i_rol === ROL_ADMIN && user.id_client) {
        Object.defineProperty(req, "query", {
          value: { ...req.query, id_client: String(user.id_client) },
          writable: true,
          configurable: true,
        });
      }
    }
  } catch (e) {
    console.error("[TENANT-LISTA] error", e);
  }
  next();
};

// ---------- Paso 4: los clientes no deben ver datos de promotores ----------
// Pasar a true cuando el log [PROMOTORES-CLIENTE] salga limpio.
export const PROMOTORES_BLOQUEAR = true;
const RUTAS_PROMOTORES = /^\/(admin\/)?promoters(\/|$)/;

export const vigilarPromotores = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (RUTAS_PROMOTORES.test(req.path)) {
      const user = await usuarioDe(req);
      const permitida = req.method === "GET" && /^\/admin\/promoters\/?$/.test(req.path);
      if (user && !user.phone && user.i_rol === ROL_ADMIN && !permitida) {
        const ruta = String(req.originalUrl).split("?")[0].replace(/\/\d+/g, "/:n");
        console.warn(`[PROMOTORES-CLIENTE] user=${user.id} cliente=${user.id_client} ${req.method} ${ruta}`);
        if (PROMOTORES_BLOQUEAR) {
          res.status(403).json({ ok: false, data: null, message: "No tienes permiso para esta acción" });
          return;
        }
      }
    }
  } catch (e) {
    console.error("[PROMOTORES-CLIENTE] error", e);
  }
  next();
};

// ---------- Paso 5: acciones que solo debe hacer el super admin ----------
// Pasar a true cuando el log [SOLO-SUPER] salga limpio.
export const SOLO_SUPER_BLOQUEAR = true;
const ACCIONES_SOLO_SUPER: Array<[string, RegExp]> = [
  ["POST", /^\/clients\/?$/],
  ["DELETE", /^\/clients\/\d+\/?$/],
  ["PUT", /^\/stores\/\d+\/?$/],
  ["DELETE", /^\/stores\/\d+\/?$/],
  ["POST", /^\/questions\/?$/],
  ["PUT", /^\/questions\/\d+\/?$/],
  ["DELETE", /^\/questions\/\d+\/?$/],
  ["PUT", /^\/questions\/assign-clients\/\d+\/?$/],
];

export const vigilarSoloSuper = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (ACCIONES_SOLO_SUPER.some(([m, rx]) => m === req.method && rx.test(req.path))) {
      const user = await usuarioDe(req);
      if (user && !user.phone && user.i_rol === ROL_ADMIN) {
        const ruta = String(req.originalUrl).split("?")[0].replace(/\/\d+/g, "/:n");
        console.warn(`[SOLO-SUPER] user=${user.id} cliente=${user.id_client} ${req.method} ${ruta}`);
        if (SOLO_SUPER_BLOQUEAR) {
          res.status(403).json({ ok: false, data: null, message: "No tienes permiso para esta acción" });
          return;
        }
      }
    }
  } catch (e) {
    console.error("[SOLO-SUPER] error", e);
  }
  next();
};
