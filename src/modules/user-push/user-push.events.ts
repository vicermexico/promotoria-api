import { prisma } from '../../core/prisma'
import { notifyClientUsers, notifyMasters, UserPushMessage } from './user-push.service'
import { routeDateLabel } from '../driver-push/driver-push.service'

/**
 * Avisos importantes para master y cliente. Todas las funciones son "disparar y olvidar":
 * nunca truenan ni hacen esperar a quien las llama.
 */

const money = (n: number) =>
    `$${Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function fire(what: string, job: () => Promise<unknown>): void {
    job().catch((e) => console.error(`[user-push] ${what}:`, e?.message ?? e))
}

async function clientName(id_client: number): Promise<string> {
    const c = await prisma.clients.findUnique({ where: { id_client }, select: { name: true } })
    return c?.name?.trim() || 'Un cliente'
}

async function taskInfo(id_task: number) {
    const t = await prisma.tasks.findUnique({
        where: { id_task },
        select: { id_client: true, store: { select: { name: true } } },
    })
    return t ? { id_client: t.id_client, store: t.store?.name?.trim() || 'la tienda' } : null
}

async function invoiceInfo(id: number) {
    const inv = await prisma.client_charge_orders.findUnique({ where: { id }, select: { vc_folio: true, id_charge: true } })
    if (!inv) return null
    const ch = await prisma.client_charges.findUnique({ where: { id_charge: inv.id_charge }, select: { id_client: true } })
    return ch ? { folio: inv.vc_folio ?? String(id), id_client: ch.id_client } : null
}

const toClient = (id_client: number, msg: UserPushMessage) => notifyClientUsers(id_client, msg)

// ---------- Recargas de saldo ----------
export function notifyTopupCreated(id_client: number, amount: number): void {
    fire('topup creada', async () => {
        const name = await clientName(id_client)
        await notifyMasters({ title: 'Recarga por aprobar', body: `${name} subió un comprobante de recarga por ${money(amount)}.`, link: '/recargas' })
    })
}
export function notifyTopupApproved(id_client: number, amount: number, balance: number): void {
    fire('topup aprobada', () =>
        toClient(id_client, { title: 'Recarga aprobada', body: `Se abonaron ${money(amount)} a tu saldo. Saldo actual: ${money(balance)}.`, link: '/mi-saldo' }))
}
export function notifyTopupRejected(id_client: number, reason: string): void {
    fire('topup rechazada', () =>
        toClient(id_client, { title: 'Recarga rechazada', body: `No se pudo aprobar tu recarga: ${reason}`.slice(0, 200), link: '/mi-saldo' }))
}

// ---------- Facturas ----------
export function notifyChargeCreated(id_client: number, folio: string | null | undefined, total: number, dueDate: Date | string | null | undefined): void {
    fire('corte generado', () =>
        toClient(id_client, {
            title: 'Nueva factura por pagar',
            body: `Se generó tu corte${folio ? ` ${folio}` : ''} por ${money(total)}.${dueDate ? ` Fecha límite de pago: ${routeDateLabel(dueDate)}.` : ''}`,
            link: '/finanzas/gestion-pagos',
        }))
}
export function notifyInvoicePaymentSubmitted(id_invoice: number): void {
    fire('pago de factura enviado', async () => {
        const inv = await invoiceInfo(id_invoice)
        if (!inv) return
        const name = await clientName(inv.id_client)
        await notifyMasters({ title: 'Pago por validar', body: `${name} subió el comprobante de pago de la factura ${inv.folio}.`, link: '/finanzas/cobro-clientes' })
    })
}
export function notifyInvoiceApproved(id_invoice: number): void {
    fire('factura pagada', async () => {
        const inv = await invoiceInfo(id_invoice)
        if (!inv) return
        await toClient(inv.id_client, { title: 'Pago validado', body: `Tu pago de la factura ${inv.folio} fue validado. ¡Gracias!`, link: '/finanzas/gestion-pagos' })
    })
}
export function notifyInvoiceObserved(id_invoice: number, reason?: string | null): void {
    fire('factura observada', async () => {
        const inv = await invoiceInfo(id_invoice)
        if (!inv) return
        await toClient(inv.id_client, {
            title: 'Revisa tu pago',
            body: `Tu pago de la factura ${inv.folio} tiene una observación${reason ? `: ${reason}` : ''}`.slice(0, 200),
            link: '/finanzas/gestion-pagos',
        })
    })
}

// ---------- Visitas (tareas) ----------
export function notifyTaskReadyForReview(id_task: number): void {
    fire('visita lista para revisar', async () => {
        const t = await taskInfo(id_task)
        if (!t) return
        await toClient(t.id_client, { title: 'Visita lista para revisar', body: `El promotor terminó la visita en ${t.store}. Revísala y apruébala o recházala.`, link: `/tareas/${id_task}` })
    })
}
export function notifyTaskDisputed(id_task: number): void {
    fire('visita rechazada', async () => {
        const t = await taskInfo(id_task)
        if (!t) return
        const name = await clientName(t.id_client)
        await notifyMasters({ title: 'Visita rechazada por revisar', body: `${name} rechazó la visita en ${t.store}. Necesita tu decisión.`, link: '/rechazos' })
    })
}
export function notifyDisputeConfirmed(id_task: number): void {
    fire('rechazo confirmado', async () => {
        const t = await taskInfo(id_task)
        if (!t) return
        await toClient(t.id_client, { title: 'Rechazo aceptado', body: `Se aceptó tu rechazo de la visita en ${t.store} y se devolvió el cargo.`, link: `/tareas/${id_task}` })
    })
}
export function notifyDisputeUpheld(id_task: number): void {
    fire('rechazo no procede', async () => {
        const t = await taskInfo(id_task)
        if (!t) return
        await toClient(t.id_client, { title: 'Revisión de visita', body: `Revisamos tu rechazo de la visita en ${t.store}: se mantiene como realizada.`, link: `/tareas/${id_task}` })
    })
}
