import { Request, Response } from 'express'
import { ClientCharges } from './client-charges.service'
import { StorageService } from '../../../services/storage.service'
import { ROLES } from '../../../core/constants/status.constants'
import { GenerateChargesDTO, ChargeFiltersDTO, InvoiceFiltersDTO, UpdateInvoicePaymentDTO, UpdateInvoiceStatusDTO, UpdateInvoiceDueDateDTO } from './client-charges.dto'

const clientChargesService = new ClientCharges()

function parseNumber(value: any): number | undefined {
    if (value === undefined || value === null || value === '') return undefined
    const num = Number(value)
    return isNaN(num) ? undefined : num
}

export const previewClientCharges = async (req: Request, res: Response) => {
    try {
        const input: GenerateChargesDTO = {
            dt_start: new Date(req.body.dt_start),
            dt_end: new Date(req.body.dt_end),
            dt_due: new Date(req.body.dt_due),
            id_client: req.body.id_client,
            id_user_creator: req.user!.id,
        }
        const result = await clientChargesService.preview(input)
        res.status(200).json({ ok: true, error: 0, data: result, message: 'Preview generado exitosamente' })
    } catch (error) {
        console.error('PREVIEW CLIENT CHARGES ERROR:', (error as any).message)
        res.status(500).json({ ok: false, error: 1, data: null, message: 'Error al generar el preview', error_backend: error })
    }
}

export const generateClientCharges = async (req: Request, res: Response) => {
    try {
        const input: GenerateChargesDTO = {
            dt_start: new Date(req.body.dt_start),
            dt_end: new Date(req.body.dt_end),
            dt_due: new Date(req.body.dt_due),
            id_client: req.body.id_client,
            id_user_creator: req.user!.id,
        }
        const charges = await clientChargesService.generate(input)
        res.status(200).json({ ok: true, error: 0, data: charges, message: `${charges.length} corte(s) generado(s) exitosamente` })
    } catch (error) {
        console.error('GENERATE CLIENT CHARGES ERROR:', (error as any).message)
        res.status(409).json({ ok: false, error: 1, data: null, message: (error as any).message || 'Error al generar el corte', error_backend: error })
    }
}

export const getAllClientCharges = async (req: Request, res: Response) => {
    try {
        const filters: ChargeFiltersDTO = {
            id_client: req.user!.i_rol === ROLES.ADMIN ? req.user!.id_client : parseNumber(req.query.id_client),
            dt_start: req.query.dt_start ? new Date(req.query.dt_start as string) : undefined,
            dt_end: req.query.dt_end ? new Date(req.query.dt_end as string) : undefined,
            vc_folio: req.query.vc_folio as string | undefined,
            page: parseNumber(req.query.page),
            limit: parseNumber(req.query.limit),
        }
        const result = await clientChargesService.list(filters)
        res.status(200).json({ ok: true, error: 0, data: result, message: 'Cortes obtenidos exitosamente' })
    } catch (error) {
        console.error('GET ALL CLIENT CHARGES ERROR:', (error as any).message)
        res.status(500).json({ ok: false, error: 1, data: null, message: 'Error al obtener los cortes', error_backend: error })
    }
}

export const getClientChargeById = async (req: Request, res: Response) => {
    try {
        const id_charge = Number(req.params.id_charge)
        const charge = await clientChargesService.getById(id_charge)
        if (!charge) {
            res.status(404).json({ ok: false, error: 1, data: null, message: 'Corte no encontrado' })
            return
        }
        if (req.user!.i_rol === ROLES.ADMIN && charge.id_client !== req.user!.id_client) {
            res.status(403).json({ ok: false, error: 1, data: null, message: 'No tienes permiso para ver este corte' })
            return
        }
        res.status(200).json({ ok: true, error: 0, data: charge, message: 'Corte obtenido exitosamente' })
    } catch (error) {
        console.error('GET CLIENT CHARGE BY ID ERROR:', (error as any).message)
        res.status(500).json({ ok: false, error: 1, data: null, message: 'Error al obtener el corte', error_backend: error })
    }
}

// ==================== FACTURAS INDIVIDUALES ====================

export const getAllInvoices = async (req: Request, res: Response) => {
    try {
        const filters: InvoiceFiltersDTO = {
            id_client: req.user!.i_rol === ROLES.ADMIN ? req.user!.id_client : parseNumber(req.query.id_client),
            id_status: parseNumber(req.query.id_status),
            dt_start: req.query.dt_start ? new Date(req.query.dt_start as string) : undefined,
            dt_end: req.query.dt_end ? new Date(req.query.dt_end as string) : undefined,
            vc_folio: req.query.vc_folio as string | undefined,
            b_overdue: req.query.b_overdue === 'true',
            page: parseNumber(req.query.page),
            limit: parseNumber(req.query.limit),
        }
        const result = await clientChargesService.listInvoices(filters)
        res.status(200).json({ ok: true, error: 0, data: result, message: 'Facturas obtenidas exitosamente' })
    } catch (error) {
        console.error('GET ALL INVOICES ERROR:', (error as any).message)
        res.status(500).json({ ok: false, error: 1, data: null, message: 'Error al obtener las facturas', error_backend: error })
    }
}

export const getInvoiceById = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id_invoice)
        const invoice = await clientChargesService.getInvoiceById(id)
        if (!invoice) {
            res.status(404).json({ ok: false, error: 1, data: null, message: 'Factura no encontrada' })
            return
        }
        if (req.user!.i_rol === ROLES.ADMIN && invoice.charge.id_client !== req.user!.id_client) {
            res.status(403).json({ ok: false, error: 1, data: null, message: 'No tienes permiso para ver esta factura' })
            return
        }
        res.status(200).json({ ok: true, error: 0, data: invoice, message: 'Factura obtenida exitosamente' })
    } catch (error) {
        console.error('GET INVOICE BY ID ERROR:', (error as any).message)
        res.status(500).json({ ok: false, error: 1, data: null, message: 'Error al obtener la factura', error_backend: error })
    }
}

export const getPendingOrders = async (req: Request, res: Response) => {
    try {
        const id_client = req.user!.i_rol === ROLES.ADMIN ? req.user!.id_client : parseNumber(req.query.id_client)
        if (id_client === undefined) {
            res.status(400).json({ ok: false, error: 1, data: null, message: 'id_client es requerido' })
            return
        }
        const result = await clientChargesService.getPendingOrders(id_client)
        res.status(200).json({ ok: true, error: 0, data: result, message: 'Pedidos por facturar obtenidos exitosamente' })
    } catch (error) {
        console.error('GET PENDING ORDERS ERROR:', (error as any).message)
        res.status(500).json({ ok: false, error: 1, data: null, message: 'Error al obtener los pedidos por facturar', error_backend: error })
    }
}

export const submitInvoicePayment = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id_invoice)
        const existing = await clientChargesService.getInvoiceRaw(id)
        if (!existing) {
            res.status(404).json({ ok: false, error: 1, data: null, message: 'Factura no encontrada' })
            return
        }
        if (existing.charge.id_client !== req.user!.id_client) {
            res.status(403).json({ ok: false, error: 1, data: null, message: 'No tienes permiso para pagar esta factura' })
            return
        }
        if (!req.file) {
            res.status(400).json({ ok: false, error: 1, data: null, message: 'La evidencia del comprobante de pago es requerida' })
            return
        }

        await StorageService.uploadAsset({
            entity: 'client_charge_order',
            entity_id: id,
            buffer: req.file.buffer,
            mime: req.file.mimetype,
            id_client: existing.charge.id_client,
            folio: existing.vc_folio,
            id_user: req.user!.id,
            originalName: req.file.originalname,
            optimize: false,
        })

        const payload: UpdateInvoicePaymentDTO = {
            dt_payment: new Date(req.body.dt_payment),
            vc_payment_method: req.body.vc_payment_method,
        }
        const updated = await clientChargesService.submitInvoicePayment(id, payload, req.user!.id)

        res.status(200).json({ ok: true, error: 0, data: updated, message: 'Comprobante de pago registrado exitosamente' })
    } catch (error) {
        console.error('SUBMIT INVOICE PAYMENT ERROR:', (error as any).message)
        res.status(409).json({ ok: false, error: 1, data: null, message: (error as any).message || 'Error al registrar el pago', error_backend: error })
    }
}

export const updateInvoiceDueDate = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id_invoice)
        const payload: UpdateInvoiceDueDateDTO = { dt_due: new Date(req.body.dt_due) }
        const updated = await clientChargesService.updateInvoiceDueDate(id, payload.dt_due, req.user!.id)
        res.status(200).json({ ok: true, error: 0, data: updated, message: 'Fecha de vencimiento actualizada exitosamente' })
    } catch (error) {
        console.error('UPDATE INVOICE DUE DATE ERROR:', (error as any).message)
        res.status(409).json({ ok: false, error: 1, data: null, message: (error as any).message || 'Error al actualizar la fecha de vencimiento', error_backend: error })
    }
}

export const updateInvoiceStatus = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id_invoice)
        const payload: UpdateInvoiceStatusDTO = {
            action: req.body.action,
            vc_rejection_reason: req.body.vc_rejection_reason,
        }
        const updated = await clientChargesService.updateInvoiceStatus(id, payload, req.user!.id)
        res.status(200).json({ ok: true, error: 0, data: updated, message: 'Estatus de la factura actualizado exitosamente' })
    } catch (error) {
        console.error('UPDATE INVOICE STATUS ERROR:', (error as any).message)
        res.status(409).json({ ok: false, error: 1, data: null, message: (error as any).message || 'Error al actualizar el estatus', error_backend: error })
    }
}
