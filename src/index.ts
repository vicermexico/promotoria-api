import { aplicarTenant, aplicarTenantRecursos, tenantQueryBody, forzarMiCliente, vigilarPromotores, vigilarSoloSuper } from "./core/middleware/tenant.middleware";
import { authMiddleware as authGuardia } from "./core/middleware";
import "dotenv/config"
import cors from "cors"
import helmet from "helmet"
import morgan from "morgan"
import express, { Express, Request, Response, NextFunction } from "express"
import { startTaskNotificacitonScheduler, startEnRouteTimeoutScheduler, startReviewTimeoutScheduler, startOrderAutoCloseScheduler, startRouteScheduleScheduler, queues } from "./core/bullmq"
import { initializeBullBoard, serverAdapter } from "./queues/helpers/bullboard"

import adminRouter from "./app_admin/index"
import superadminRouter from "./app_superadmin/index"
import staffRouter from "./modules/staff/staff.routes"
import faqClienteRouter from "./modules/faq-cliente/faq-cliente.routes";
import { vigilarEquipo } from "./modules/staff/permisos.guard";
import mobileRouter from "./app_mobile/index"
import { clientRouter, productRouter, userAdminRouter, storeRouter, channelsSalesRouter, promoterRouter, questionRouter, requestRouter, orderRouter, taskRouter, financesRouter, taskSettingsRouter, appConfigRouter, stockRouter, preorderRouter, driversRouter, deliveryRoutesRouter, routeTemplatesRouter, routeSchedulesRouter, introVideosRouter, faqRouter } from './modules'
import promoterSelfPaymentsRouter from './modules/promoter-payments-self/promoter-self-payments.routes'
import { errorHandler } from "./core/middleware"
import { setupSwagger } from "./config/swagger"

export const app: Express = express()
const PORT = parseInt(process.env.PORT || "3000", 10)

app.use(cors())

// Documentación Swagger (antes de helmet para evitar bloqueos de CSP en la UI).
setupSwagger(app)

app.use(helmet())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(morgan("dev"))

// Sin esto, el navegador (o un proxy en medio) puede quedarse con respuestas
// viejas en cache y regresar 304 aunque los datos ya cambiaron de verdad en
// el servidor (ej. crear una pregunta nueva y que la lista siga mostrando
// solo las de antes hasta que el navegador decida refrescar su cache). Toda
// esta API es dinamica, ninguna respuesta deberia cachearse del lado del
// cliente.
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.set("Cache-Control", "no-store")
  next()
})

// Bull Board UI
initializeBullBoard(queues)
app.use("/retailink-api/queues", serverAdapter.getRouter())
startTaskNotificacitonScheduler()
startEnRouteTimeoutScheduler()
startReviewTimeoutScheduler()
startOrderAutoCloseScheduler()
startRouteScheduleScheduler()

// Guardia de sesión para los grupos que antes estaban abiertos.
// Solo estas rutas pueden usarse SIN iniciar sesión.
const PUBLICAS: Record<string, RegExp[]> = {
  admin: [
    /^POST \/login$/,
    /^GET \/check-phone\/[^/]+$/,
    /^POST \/restore-password$/,
    /^POST \/reset-password$/,
    /^GET \/countries$/,
    /^GET \/states\/\d+$/,
    /^GET \/cities\/\d+\/\d+$/,
  ],
  superadmin: [/^POST \/login$/],
  mobile: [/^GET \/$/],
};
// Pasar a true cuando el log confirme que ningun cliente usa rutas de superadmin.
const BLOQUEAR_ROL = true;
const guardia = (grupo: string) => (req: any, res: any, next: any) => {
  if (req.method === "OPTIONS") return next();
  const clave = `${req.method} ${req.path}`;
  if ((PUBLICAS[grupo] || []).some((r) => r.test(clave))) return next();
  if (grupo !== "superadmin") return authGuardia(req, res, next);
  return authGuardia(req, res, () => {
    if (req.user?.i_rol !== 1) {
      const ruta = String(req.originalUrl).split("?")[0].replace(/\/\d+/g, "/:n");
      console.warn(`[ROL-NO-SUPER] rol=${req.user?.i_rol} ${req.method} ${ruta}`);
      if (BLOQUEAR_ROL) return res.status(403).json({ ok: false, message: "No tienes permiso para esta acción" });
    }
    next();
  });
};

// Modo vigilancia: solo anota las llamadas sin credencial, NO bloquea nada.
app.use("/retailink-api", (req: any, _res: any, next: any) => {
  if (!req.headers.authorization) {
    const ruta = String(req.originalUrl).split("?")[0].replace(/\/\d+/g, "/:n");
    console.warn(`[SIN-SESION] ${req.method} ${ruta}`);
  }
  next();
});
// Aislamiento entre clientes (modo vigilancia: ver TENANT_BLOQUEAR)
app.use("/retailink-api", tenantQueryBody);
app.use("/retailink-api", forzarMiCliente);
app.use("/retailink-api", vigilarPromotores);
app.use("/retailink-api", vigilarSoloSuper);
app.use("/retailink-api", vigilarEquipo);
[superadminRouter, adminRouter, mobileRouter, userAdminRouter, productRouter, clientRouter, storeRouter, channelsSalesRouter, promoterRouter, questionRouter, requestRouter, orderRouter, taskRouter, financesRouter, taskSettingsRouter, appConfigRouter, promoterSelfPaymentsRouter, stockRouter, preorderRouter, routeTemplatesRouter, routeSchedulesRouter, driversRouter, deliveryRoutesRouter, introVideosRouter, faqRouter].forEach((r) => { aplicarTenant(r); aplicarTenantRecursos(r); })

app.use("/retailink-api/superadmin/staff", guardia("superadmin"), staffRouter);
app.use("/retailink-api/superadmin", guardia("superadmin"), superadminRouter)
app.use("/retailink-api/admin", guardia("admin"), adminRouter)
app.use("/retailink-api/mobile", guardia("mobile"), mobileRouter)

app.use("/retailink-api/users", userAdminRouter)
app.use("/retailink-api/products", productRouter)
app.use("/retailink-api/clients", clientRouter)
app.use("/retailink-api/stores", storeRouter)
app.use("/retailink-api/channel-sales", channelsSalesRouter)
app.use("/retailink-api/promoters", promoterRouter)
app.use("/retailink-api/questions", questionRouter)
app.use("/retailink-api/requests", requestRouter)
app.use("/retailink-api/orders", orderRouter)
app.use("/retailink-api/tasks", taskRouter)
app.use("/retailink-api/finances", financesRouter)
app.use("/retailink-api/task-settings", taskSettingsRouter)
app.use("/retailink-api/app-config", appConfigRouter)
app.use("/retailink-api/payments", promoterSelfPaymentsRouter)
app.use("/retailink-api/stock", stockRouter)
app.use("/retailink-api/preorder", preorderRouter)
app.use("/retailink-api/route-templates", routeTemplatesRouter)
app.use("/retailink-api/route-schedules", routeSchedulesRouter)
app.use("/retailink-api/drivers", driversRouter)
app.use("/retailink-api/delivery-routes", deliveryRoutesRouter)
app.use("/retailink-api/intro-videos", introVideosRouter)
app.use("/retailink-api/faq", faqRouter)
app.use("/retailink-api/faq-cliente", faqClienteRouter);

// Manejo global de errores (multer, no controlados): debe ir después de todas las rutas.
app.use(errorHandler)

if (process.env.NODE_ENV !== 'test') {
  const startServer = async () => {
    try {
      app.listen(PORT, "0.0.0.0", () => {
        console.log(`Server is running on port ${PORT}`)
      })
    } catch (error) {
      console.error("Error starting server:", error)
    }
  }
  startServer()
}
