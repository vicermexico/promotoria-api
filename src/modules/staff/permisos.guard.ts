import { Request, Response, NextFunction } from "express";
import { Utils } from "../../core/utils";
import { prisma } from '../../core/prisma'

// Pasar a true cuando el log [EQUIPO-SIN-PERMISO] salga limpio.
export const EQUIPO_BLOQUEAR = false;

// [ruta del servidor, botones del menu que la permiten]
const FIN = ["/finanzas/cobro-clientes", "/finanzas/pago-promotores", "/finanzas/pago-activadores"];
const MAPA: Array<[RegExp, string[]]> = [
  [/^\/(users\/client-user|clients\/?$|clients\/\d+|superadmin\/(create-client|client\/|get_clients_list|get_client\/))/, ["/clientes"]],
  [/^\/promoters/, ["/promotores"]],
  [/^\/products/, ["/productos"]],
  [/^\/(superadmin\/stores|stores)/, ["/establecimientos"]],
  [/^\/channel-sales/, ["/canales-venta"]],
  [/^\/(superadmin\/questions|superadmin\/questions-client|questions)/, ["/preguntas"]],
  [/^\/(requests|superadmin\/cotizaciones|admin\/cotizaciones)/, ["/solicitudes"]],
  [/^\/(orders|preorder)/, ["/pedidos"]],
  [/^\/tasks/, ["/tareas"]],
  [/^\/(delivery-routes|route-templates|route-schedules|drivers|stock)/, ["/logistica"]],
  [/^\/(app-config|task-settings)/, ["/configurar-app"]],
  [/^\/intro-videos/, ["/videos-introduccion"]],
  [/^\/faq-cliente/, ["/dudas-cliente"]],
  [/^\/faq/, ["/dudas-preguntas"]],
  [/^\/finances\/client-charges/, ["/finanzas/cobro-clientes"]],
  [/^\/finances\/promoter-payments/, ["/finanzas/pago-promotores"]],
  [/^\/finances\/activator-payments/, ["/finanzas/pago-activadores"]],
  [/^\/finances/, FIN],
];

async function tokenSeguro(t: string): Promise<any> { try { return await Utils.verify_token(t); } catch { return null; } }
const LECTURA = new Set(["/clientes", "/establecimientos", "/productos", "/promotores", "/canales-venta"]);
const OPER = ["/solicitudes", "/pedidos", "/tareas", "/logistica"];
const cache = new Map<number, { p: string[] | null; t: number }>();

async function permisosDe(id: number): Promise<string[] | null> {
  const c = cache.get(id);
  if (c && Date.now() - c.t < 20000) return c.p;
  const u: any = await (prisma as any).users.findUnique({ where: { id_user: id }, select: { vc_permisos: true } });
  let p: string[] | null = null;
  if (u && u.vc_permisos !== null && u.vc_permisos !== undefined) {
    try {
      const v = JSON.parse(u.vc_permisos);
      p = Array.isArray(v) ? v : [];
    } catch {
      p = [];
    }
  }
  cache.set(id, { p, t: Date.now() });
  return p;
}

export const vigilarEquipo = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const h = req.headers.authorization;
    if (h && h.startsWith("Bearer ")) {
      const user: any = (req as any).user || (await tokenSeguro(h.split(" ")[1]));
      if (user && user.i_rol === 1 && !user.phone && user.id) {
        const permisos = await permisosDe(Number(user.id));
        if (permisos !== null) {
          const item = MAPA.find(([rx]) => rx.test(req.path));
          if (item && !item[1].some((k) => permisos.includes(k)) && !(req.method === "GET" && LECTURA.has(item[1][0]) && OPER.some((k) => permisos.includes(k)))) {
            const ruta = String(req.originalUrl).split("?")[0].replace(/\/\d+/g, "/:n");
            console.warn(`[EQUIPO-SIN-PERMISO] user=${user.id} necesita=${item[1][0]} ${req.method} ${ruta}`);
            if (EQUIPO_BLOQUEAR) {
              res.status(403).json({ ok: false, data: null, message: "No tienes permiso para esta acción" });
              return;
            }
          }
        }
      }
    }
  } catch (e) {
    console.error("[EQUIPO-SIN-PERMISO] error", e);
  }
  next();
};
