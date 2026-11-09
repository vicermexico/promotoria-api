import { prisma } from '../../core/prisma'

export interface DriverPushMessage {
    title: string
    body: string
    link?: string
}

export interface PushSubscriptionInput {
    endpoint: string
    keys: { p256dh: string; auth: string }
}

// web-push se carga al momento de usarse y con las llaves VAPID del .env.
let _wp: any = null
export async function getWebPush(): Promise<any> {
    if (_wp) return _wp
    const pub = process.env.VAPID_PUBLIC_KEY
    const priv = process.env.VAPID_PRIVATE_KEY
    if (!pub || !priv) throw new Error('Faltan VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY en el .env')
    const name = 'web-push'
    const mod: any = await import(name)
    const wp = mod.default ?? mod
    wp.setVapidDetails(process.env.VAPID_SUBJECT || 'https://promotoriadigital.app', pub, priv)
    _wp = wp
    return wp
}

export function getVapidPublicKey(): string {
    return process.env.VAPID_PUBLIC_KEY || ''
}

/** Guarda (o actualiza) un celular/navegador del chofer para mandarle avisos. */
export async function registerDriverDevice(id_driver: number, sub: PushSubscriptionInput, platform: string) {
    await prisma.$executeRaw`
        INSERT INTO driver_push_subscriptions (id_driver, vc_endpoint, vc_p256dh, vc_auth, vc_platform)
        VALUES (${id_driver}, ${sub.endpoint}, ${sub.keys.p256dh}, ${sub.keys.auth}, ${platform})
        ON DUPLICATE KEY UPDATE id_driver = VALUES(id_driver), vc_p256dh = VALUES(vc_p256dh), vc_auth = VALUES(vc_auth), vc_platform = VALUES(vc_platform), dt_last_seen = CURRENT_TIMESTAMP`
}

export async function removeDriverDevice(id_driver: number, endpoint: string) {
    await prisma.$executeRaw`DELETE FROM driver_push_subscriptions WHERE id_driver = ${id_driver} AND vc_endpoint = ${endpoint}`
}

type Row = { vc_endpoint: string; vc_p256dh: string; vc_auth: string }

/** Manda un aviso a todos los dispositivos del chofer. Quita los que ya no existen. */
export async function notifyDriver(id_driver: number, msg: DriverPushMessage): Promise<{ devices: number; sent: number }> {
    const rows = await prisma.$queryRaw<Row[]>`SELECT vc_endpoint, vc_p256dh, vc_auth FROM driver_push_subscriptions WHERE id_driver = ${id_driver}`
    if (rows.length === 0) return { devices: 0, sent: 0 }

    const wp = await getWebPush()
    const payload = JSON.stringify({ title: msg.title, body: msg.body, link: msg.link ?? '/chofer/ruta' })
    let sent = 0
    for (const r of rows) {
        try {
            await wp.sendNotification(
                { endpoint: r.vc_endpoint, keys: { p256dh: r.vc_p256dh, auth: r.vc_auth } },
                payload,
                { TTL: 60 * 60 * 24, urgency: 'high' }
            )
            sent++
        } catch (e: any) {
            if (e?.statusCode === 404 || e?.statusCode === 410) {
                await prisma.$executeRaw`DELETE FROM driver_push_subscriptions WHERE vc_endpoint = ${r.vc_endpoint}`
            } else {
                console.error('notifyDriver push error:', e?.statusCode, e?.body ?? e?.message)
            }
        }
    }
    return { devices: rows.length, sent }
}

/** Igual que notifyDriver, pero nunca truena ni hace esperar al que lo llama. */
export function notifyDriverSafe(id_driver: number, msg: DriverPushMessage): void {
    notifyDriver(id_driver, msg).catch((e) => console.error('notifyDriverSafe:', e?.message ?? e))
}

/** "3 de noviembre" a partir de una fecha de ruta (se guarda como fecha sin hora). */
export function routeDateLabel(d: Date | string): string {
    return new Date(d).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', timeZone: 'UTC' })
}
