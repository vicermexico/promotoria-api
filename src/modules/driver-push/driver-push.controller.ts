import { Request, Response } from 'express'
import { prisma } from '../../core/prisma'
import { registerDriverDevice, removeDriverDevice, notifyDriver, getVapidPublicKey } from './driver-push.service'

const isDriver = (req: Request) => (req.user as any)?.type === 'driver'
const forbidden = (res: Response) => res.status(403).json({ ok: false, error: 1, data: null, message: 'Solo para choferes' })

// Llave publica que el navegador necesita para suscribirse a los avisos.
export const getMyPushKey = async (req: Request, res: Response) => {
    if (!isDriver(req)) { forbidden(res); return }
    const publicKey = getVapidPublicKey()
    if (!publicKey) {
        res.status(503).json({ ok: false, error: 1, data: null, message: 'Las notificaciones aún no están configuradas en el servidor' })
        return
    }
    res.status(200).json({ ok: true, error: 0, data: { publicKey }, message: 'OK' })
}

export const registerMyDevice = async (req: Request, res: Response) => {
    try {
        if (!isDriver(req)) { forbidden(res); return }
        const sub = req.body?.subscription
        const endpoint = String(sub?.endpoint ?? '').trim()
        const p256dh = String(sub?.keys?.p256dh ?? '').trim()
        const auth = String(sub?.keys?.auth ?? '').trim()
        if (!endpoint.startsWith('https://') || endpoint.length > 600 || !p256dh || p256dh.length > 200 || !auth || auth.length > 100) {
            res.status(400).json({ ok: false, error: 1, data: null, message: 'suscripción inválida' })
            return
        }
        const platform = String(req.body?.platform ?? 'web').slice(0, 20)
        await registerDriverDevice(req.user!.id, { endpoint, keys: { p256dh, auth } }, platform)
        res.status(200).json({ ok: true, error: 0, data: null, message: 'Notificaciones activadas' })
    } catch (error) {
        console.error('registerMyDevice: ', error)
        res.status(500).json({ ok: false, error: 1, data: null, message: 'No se pudieron activar las notificaciones' })
    }
}

export const removeMyDevice = async (req: Request, res: Response) => {
    try {
        if (!isDriver(req)) { forbidden(res); return }
        const endpoint = String(req.body?.endpoint ?? '').trim()
        if (endpoint) await removeDriverDevice(req.user!.id, endpoint)
        res.status(200).json({ ok: true, error: 0, data: null, message: 'Listo' })
    } catch (error) {
        console.error('removeMyDevice: ', error)
        res.status(500).json({ ok: false, error: 1, data: null, message: 'Error' })
    }
}

// El cliente (o el master) le manda un mensaje a un chofer suyo.
export const notifyDriverFromPanel = async (req: Request, res: Response) => {
    try {
        if (isDriver(req)) {
            res.status(403).json({ ok: false, error: 1, data: null, message: 'No tienes permiso' })
            return
        }
        const id_driver = Number(req.params.id_driver)
        const driver = await prisma.drivers.findUnique({ where: { id_driver } })
        if (!driver || (req.user!.i_rol !== 1 && driver.id_client !== req.user!.id_client)) {
            res.status(404).json({ ok: false, error: 1, data: null, message: 'Chofer no encontrado' })
            return
        }
        const body = String(req.body?.body ?? '').trim()
        const title = String(req.body?.title ?? '').trim() || 'Mensaje de tu empresa'
        if (!body || body.length > 300) {
            res.status(400).json({ ok: false, error: 1, data: null, message: 'Escribe un mensaje de hasta 300 caracteres' })
            return
        }
        const result = await notifyDriver(id_driver, { title: title.slice(0, 80), body })
        if (result.devices === 0) {
            res.status(200).json({ ok: true, error: 0, data: result, message: 'Este chofer aún no ha activado las notificaciones' })
            return
        }
        res.status(200).json({ ok: true, error: 0, data: result, message: result.sent > 0 ? 'Mensaje enviado' : 'No se pudo entregar el mensaje' })
    } catch (error) {
        console.error('notifyDriverFromPanel: ', error)
        res.status(500).json({ ok: false, error: 1, data: null, message: 'No se pudo enviar el mensaje' })
    }
}
