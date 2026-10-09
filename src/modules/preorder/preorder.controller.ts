import { Request, Response } from 'express'
import { Preorder } from './preorder.service'

const preorderService = new Preorder()

export const getDeliveryTurno = async (req: Request, res: Response) => {
    try {
        const id_task = Number(req.params.id_task)
        const data = await preorderService.getDeliveryTurno(id_task)
        res.status(200).json({ ok: true, error: 0, data, message: 'Turno obtenido exitosamente' })
    } catch (error) {
        res.status(500).json({ ok: false, error: 1, data: null, message: (error as any).message || 'Error al obtener el turno' })
    }
}

export const getPreorderShortfall = async (req: Request, res: Response) => {
    try {
        const id_task = Number(req.params.id_task)
        const result = await preorderService.getShortfall(id_task)
        res.status(200).json({ ok: true, error: 0, data: result, message: 'Faltante calculado exitosamente' })
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Error al calcular el faltante'
        console.error('f.getPreorderShortfall: ', error)
        res.status(400).json({ ok: false, error: 1, data: null, message })
    }
}

export const createPreorder = async (req: Request, res: Response) => {
    try {
        const id_task = Number(req.params.id_task)
        const { manager_whatsapp, preferred_date, preferred_time, items } = req.body

        if (!req.file) {
            res.status(400).json({ ok: false, error: 1, data: null, message: 'La firma es requerida' })
            return
        }
        if (preferred_time && preferred_time !== 'MAÑANA' && preferred_time !== 'TARDE') {
            res.status(400).json({ ok: false, error: 1, data: null, message: 'preferred_time debe ser MAÑANA o TARDE' })
            return
        }

        const parsedItems = typeof items === 'string' ? JSON.parse(items) : items

        const preorder = await preorderService.createPreorder({
            id_task,
            manager_whatsapp,
            preferred_date: preferred_date ? new Date(preferred_date) : undefined,
            preferred_time: preferred_time || undefined,
            signature: { buffer: req.file.buffer, mime: req.file.mimetype },
            items: parsedItems,
        })

        res.status(201).json({ ok: true, error: 0, data: preorder, message: 'Prepedido guardado exitosamente' })
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Error al guardar el prepedido'
        console.error('f.createPreorder: ', error)
        res.status(400).json({ ok: false, error: 1, data: null, message })
    }
}

export const getPreorder = async (req: Request, res: Response) => {
    try {
        const id_task = Number(req.params.id_task)
        const preorder = await preorderService.getPreorder(id_task)
        res.status(200).json({ ok: true, error: 0, data: preorder, message: 'Prepedido obtenido exitosamente' })
    } catch (error) {
        console.error('f.getPreorder: ', error)
        res.status(500).json({ ok: false, error: 1, data: null, message: 'Error al obtener el prepedido' })
    }
}

/**
 * Todos los prepedidos de un cliente empresarial, para que los vea en su
 * panel (que tienda, que dia/turno pidieron, y que se va a surtir).
 */
export const getPreordersByClient = async (req: Request, res: Response) => {
    try {
        const id_client = Number(req.params.id_client)
        const preorders = await preorderService.getPreordersByClient(id_client)
        res.status(200).json({ ok: true, error: 0, data: preorders, message: 'Prepedidos obtenidos exitosamente' })
    } catch (error) {
        console.error('f.getPreordersByClient: ', error)
        res.status(500).json({ ok: false, error: 1, data: null, message: 'Error al obtener los prepedidos' })
    }
}

/**
 * El cliente empresarial marca un prepedido como surtido (o de vuelta a sin
 * surtir) desde su panel de "Mis Prepedidos".
 */
export const updatePreorderStatus = async (req: Request, res: Response) => {
    try {
        const id_task = Number(req.params.id_task)
        const { id_status } = req.body
        if (id_status !== 0 && id_status !== 1) {
            return res.status(400).json({ ok: false, error: 1, data: null, message: 'id_status debe ser 0 (sin surtir) o 1 (surtido)' })
        }
        const preorder = await preorderService.updatePreorderStatus(id_task, id_status)
        res.status(200).json({ ok: true, error: 0, data: preorder, message: 'Estatus actualizado exitosamente' })
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Error al actualizar el estatus'
        console.error('f.updatePreorderStatus: ', error)
        res.status(400).json({ ok: false, error: 1, data: null, message })
    }
}
