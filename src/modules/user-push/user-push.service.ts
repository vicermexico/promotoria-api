import { prisma } from '../../core/prisma'
import { getWebPush, PushSubscriptionInput } from '../driver-push/driver-push.service'

export interface UserPushMessage {
    title: string
    body: string
    link?: string
}

/** Guarda (o actualiza) un celular/navegador de un usuario del panel (master o cliente). */
export async function registerUserDevice(id_user: number, sub: PushSubscriptionInput, platform: string) {
    await prisma.$executeRaw`
        INSERT INTO user_push_subscriptions (id_user, vc_endpoint, vc_p256dh, vc_auth, vc_platform)
        VALUES (${id_user}, ${sub.endpoint}, ${sub.keys.p256dh}, ${sub.keys.auth}, ${platform})
        ON DUPLICATE KEY UPDATE id_user = VALUES(id_user), vc_p256dh = VALUES(vc_p256dh), vc_auth = VALUES(vc_auth), vc_platform = VALUES(vc_platform), dt_last_seen = CURRENT_TIMESTAMP`
}

export async function removeUserDevice(id_user: number, endpoint: string) {
    await prisma.$executeRaw`DELETE FROM user_push_subscriptions WHERE id_user = ${id_user} AND vc_endpoint = ${endpoint}`
}

type Row = { vc_endpoint: string; vc_p256dh: string; vc_auth: string }

/** Manda un aviso a todos los dispositivos de un usuario. Quita los que ya no existen. */
export async function notifyUser(id_user: number, msg: UserPushMessage): Promise<{ devices: number; sent: number }> {
    const rows = await prisma.$queryRaw<Row[]>`SELECT vc_endpoint, vc_p256dh, vc_auth FROM user_push_subscriptions WHERE id_user = ${id_user}`
    if (rows.length === 0) return { devices: 0, sent: 0 }

    const wp = await getWebPush()
    const payload = JSON.stringify({ title: msg.title, body: msg.body, link: msg.link ?? '/' })
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
                await prisma.$executeRaw`DELETE FROM user_push_subscriptions WHERE vc_endpoint = ${r.vc_endpoint}`
            } else {
                console.error('notifyUser push error:', e?.statusCode, e?.body ?? e?.message)
            }
        }
    }
    return { devices: rows.length, sent }
}

/** Avisa a todos los usuarios activos de un cliente (no incluye al master). */
export async function notifyClientUsers(id_client: number, msg: UserPushMessage): Promise<void> {
    const users = await prisma.users.findMany({
        where: { id_client, i_rol: { not: 1 }, i_status: 1 },
        select: { id_user: true },
    })
    for (const u of users) await notifyUser(u.id_user, msg)
}

/** Avisa a todos los usuarios master activos. */
export async function notifyMasters(msg: UserPushMessage): Promise<void> {
    const users = await prisma.users.findMany({
        where: { i_rol: 1, i_status: 1 },
        select: { id_user: true },
    })
    for (const u of users) await notifyUser(u.id_user, msg)
}
