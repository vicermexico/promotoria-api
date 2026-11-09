import { Request, Response } from 'express'
import { registerUserDevice, removeUserDevice } from './user-push.service'
import { getVapidPublicKey } from '../driver-push/driver-push.service'

// Solo usuarios del panel (master o cliente): no choferes ni promotores.
const isStaff = (req: Request) => {
    const u = req.user as any
    return !!u && u.type !== 'driver' && !u.phone && typeof u.i_rol === 'number'
}
const forbidden = (res: Response) => res.status(403).json({ ok: false, error: 1, data: null, message: 'No tienes permiso' })

export const getMyStaffPushKey = async (req: Request, res: Response) => {
    if (!isStaff(req)) { forbidden(res); return }
    const publicKey = getVapidPublicKey()
    if (!publicKey) {
        res.status(503).json({ ok: false, error: 1, data: null, message: 'Las notificaciones aún no están configuradas en el servidor' })
        return
    }
    res.status(200).json({ ok: true, error: 0, data: { publicKey }, message: 'OK' })
}

export const registerMyStaffDevice = async (req: Request, res: Response) => {
    try {
        if (!isStaff(req)) { forbidden(res); return }
        const sub = req.body?.subscription
        const endpoint = String(sub?.endpoint ?? '').trim()
        const p256dh = String(sub?.keys?.p256dh ?? '').trim()
        const auth = String(sub?.keys?.auth ?? '').trim()
        if (!endpoint.startsWith('https://') || endpoint.length > 600 || !p256dh || p256dh.length > 200 || !auth || auth.length > 100) {
            res.status(400).json({ ok: false, error: 1, data: null, message: 'suscripción inválida' })
            return
        }
        const platform = String(req.body?.platform ?? 'web').slice(0, 20)
        await registerUserDevice(req.user!.id, { endpoint, keys: { p256dh, auth } }, platform)
        res.status(200).json({ ok: true, error: 0, data: null, message: 'Notificaciones activadas' })
    } catch (error) {
        console.error('registerMyStaffDevice: ', error)
        res.status(500).json({ ok: false, error: 1, data: null, message: 'No se pudieron activar las notificaciones' })
    }
}

export const removeMyStaffDevice = async (req: Request, res: Response) => {
    try {
        if (!isStaff(req)) { forbidden(res); return }
        const endpoint = String(req.body?.endpoint ?? '').trim()
        if (endpoint) await removeUserDevice(req.user!.id, endpoint)
        res.status(200).json({ ok: true, error: 0, data: null, message: 'Listo' })
    } catch (error) {
        console.error('removeMyStaffDevice: ', error)
        res.status(500).json({ ok: false, error: 1, data: null, message: 'Error' })
    }
}
