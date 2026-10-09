import { Router } from 'express'
import { authMiddleware, requireRole, validateBody, uploadAny } from '../../../core/middleware'
import { ROLES } from '../../../core/constants/status.constants'
import {
    previewClientCharges,
    generateClientCharges,
    getAllClientCharges,
    getClientChargeById,
    getPendingOrders,
    getAllInvoices,
    getInvoiceById,
    submitInvoicePayment,
    updateInvoiceStatus,
    updateInvoiceDueDate,
} from './client-charges.controller'
import { generateChargesSchema, updateInvoicePaymentSchema, updateInvoiceStatusSchema, updateInvoiceDueDateSchema } from './client-charges.schema'

const clientChargesRouter = Router()

// ==================== CORTES (agrupadores por periodo) ====================

clientChargesRouter.post('/preview', authMiddleware, requireRole(ROLES.SUPER), validateBody(generateChargesSchema), previewClientCharges)
clientChargesRouter.post('/', authMiddleware, requireRole(ROLES.SUPER), validateBody(generateChargesSchema), generateClientCharges)
clientChargesRouter.get('/', authMiddleware, requireRole(ROLES.SUPER, ROLES.ADMIN), getAllClientCharges)
clientChargesRouter.get('/pending-orders', authMiddleware, requireRole(ROLES.SUPER, ROLES.ADMIN), getPendingOrders)
clientChargesRouter.get('/:id_charge', authMiddleware, requireRole(ROLES.SUPER, ROLES.ADMIN), getClientChargeById)

// ==================== FACTURAS INDIVIDUALES (una por pedido) ====================

/**
 * @openapi
 * /finances/client-charges/invoices:
 *   get:
 *     tags: [Finances]
 *     summary: Listar facturas individuales (por pedido) del cliente
 *     parameters:
 *       - { in: query, name: id_client, schema: { type: integer } }
 *       - { in: query, name: id_status, schema: { type: integer } }
 *       - { in: query, name: dt_start, schema: { type: string, format: date-time } }
 *       - { in: query, name: dt_end, schema: { type: string, format: date-time } }
 *       - { in: query, name: vc_folio, schema: { type: string } }
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20 } }
 *     responses:
 *       200: { description: "Página de facturas." }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
clientChargesRouter.get('/invoices/all', authMiddleware, requireRole(ROLES.SUPER, ROLES.ADMIN), getAllInvoices)

/**
 * @openapi
 * /finances/client-charges/invoices/{id_invoice}:
 *   get:
 *     tags: [Finances]
 *     summary: Detalle de una factura individual (tareas, evidencias, logs)
 *     parameters:
 *       - in: path
 *         name: id_invoice
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: "Detalle de la factura." }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: "La factura no pertenece al cliente del token." }
 *       404: { description: "Factura no encontrada." }
 */
clientChargesRouter.get('/invoices/:id_invoice', authMiddleware, requireRole(ROLES.SUPER, ROLES.ADMIN), getInvoiceById)

/**
 * @openapi
 * /finances/client-charges/invoices/{id_invoice}/payment:
 *   patch:
 *     tags: [Finances]
 *     summary: Cliente sube fecha de pago, método y evidencia del comprobante de una factura
 *     parameters:
 *       - in: path
 *         name: id_invoice
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [dt_payment, vc_payment_method]
 *             properties:
 *               dt_payment: { type: string, format: date-time }
 *               vc_payment_method: { type: string }
 *               evidence: { type: string, format: binary }
 *     responses:
 *       200: { description: "Comprobante registrado." }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: "La factura no pertenece al cliente del token." }
 *       409: { description: "La factura no está en un estatus que permita esta acción." }
 */
clientChargesRouter.patch(
    '/invoices/:id_invoice/payment',
    authMiddleware,
    requireRole(ROLES.ADMIN),
    uploadAny.single('evidence'),
    validateBody(updateInvoicePaymentSchema),
    submitInvoicePayment
)

/**
 * @openapi
 * /finances/client-charges/invoices/{id_invoice}/status:
 *   patch:
 *     tags: [Finances]
 *     summary: Super usuario aprueba, rechaza o cancela una factura
 *     parameters:
 *       - in: path
 *         name: id_invoice
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [action]
 *             properties:
 *               action: { type: string, enum: [approve, reject, cancel] }
 *               vc_rejection_reason: { type: string }
 *     responses:
 *       200: { description: "Estatus actualizado." }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       409: { description: "Transición de estatus inválida." }
 */
clientChargesRouter.patch('/invoices/:id_invoice/status', authMiddleware, requireRole(ROLES.SUPER), validateBody(updateInvoiceStatusSchema), updateInvoiceStatus)

/**
 * @openapi
 * /finances/client-charges/invoices/{id_invoice}/due-date:
 *   patch:
 *     tags: [Finances]
 *     summary: Master asigna o edita la fecha límite de pago de una factura
 *     parameters:
 *       - in: path
 *         name: id_invoice
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [dt_due]
 *             properties:
 *               dt_due: { type: string, format: date-time }
 *     responses:
 *       200: { description: "Fecha de vencimiento actualizada." }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
clientChargesRouter.patch('/invoices/:id_invoice/due-date', authMiddleware, requireRole(ROLES.SUPER), validateBody(updateInvoiceDueDateSchema), updateInvoiceDueDate)

export default clientChargesRouter
