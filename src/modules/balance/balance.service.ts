import { prisma } from '../../core/prisma'
import { StorageService } from '../../services/storage.service'
import { resolveImages } from '../../core/asset-resolver'

export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

export const PAYMENT_MODE = { CREDITO: 'CREDITO', PREPAGO: 'PREPAGO' } as const
export const TOPUP_STATUS = { PENDIENTE: 1, APROBADA: 2, RECHAZADA: 3 } as const
export const BANK_INFO_KEY = 'recharge_bank_info'

const round2 = (n: number) => Math.round(n * 100) / 100
const money = (n: number) => n.toFixed(2)
const clean = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max)

export interface BankInfo {
    bank: string
    holder: string
    clabe: string
    account: string
    instructions: string
}
const EMPTY_BANK: BankInfo = { bank: '', holder: '', clabe: '', account: '', instructions: '' }

/** Se lanza cuando el pedido cuesta mas de lo que hay en el saldo prepago. */
import { addIva } from '../finances/tax'
import { notifyTopupCreated, notifyTopupApproved, notifyTopupRejected } from '../user-push/user-push.events'

export class SaldoInsuficienteError extends Error {
    code = 'SALDO_INSUFICIENTE'
    saldo: number
    requerido: number
    faltante: number
    constructor(saldo: number, requerido: number) {
        const faltante = round2(requerido - saldo)
        super(`Saldo insuficiente: el pedido cuesta $${money(requerido)} y tu saldo es $${money(saldo)}. Te faltan $${money(faltante)}. Recarga tu saldo para continuar.`)
        this.saldo = saldo
        this.requerido = requerido
        this.faltante = faltante
    }
}

/** Bloquea la fila del cliente (nadie mas puede mover su saldo hasta que termine la transaccion). */
async function lockClient(tx: Tx, id_client: number): Promise<{ mode: string; balance: number }> {
    const rows = await tx.$queryRaw<Array<{ vc_payment_mode: string; f_balance: unknown }>>`
        SELECT vc_payment_mode, f_balance FROM clients WHERE id_client = ${id_client} FOR UPDATE`
    if (rows.length === 0) throw new Error('Cliente no encontrado')
    return { mode: rows[0].vc_payment_mode, balance: Number(rows[0].f_balance) }
}

async function applyMovement(
    tx: Tx,
    id_client: number,
    balanceBefore: number,
    delta: number,
    m: { type: string; id_order?: number | null; id_task?: number | null; id_topup?: number | null; note?: string | null; id_user?: number | null }
): Promise<number> {
    const balanceAfter = round2(balanceBefore + delta)
    await tx.clients.update({ where: { id_client }, data: { f_balance: balanceAfter } })
    await tx.client_balance_movements.create({
        data: {
            id_client,
            vc_type: m.type,
            f_amount: delta,
            f_balance_after: balanceAfter,
            id_order: m.id_order ?? null,
            id_task: m.id_task ?? null,
            id_topup: m.id_topup ?? null,
            vc_note: m.note ? m.note.slice(0, 255) : null,
            id_user: m.id_user ?? null,
        }
    })
    return balanceAfter
}

export class BalanceService {

    /** Cobra un pedido nuevo. Solo actua con clientes PREPAGO; con CREDITO no hace nada. */
    async chargeOrder(tx: Tx, p: { id_client: number; id_order: number; amount: number; folio?: string | null; id_user?: number | null }) {
        const { mode, balance } = await lockClient(tx, p.id_client)
        if (mode !== PAYMENT_MODE.PREPAGO) return { charged: false as const }
        const subtotal = round2(p.amount)
        if (subtotal <= 0) return { charged: false as const }
        const amount = addIva(subtotal).total
        if (balance + 0.0001 < amount) throw new SaldoInsuficienteError(balance, amount)
        const after = await applyMovement(tx, p.id_client, balance, -amount, {
            type: 'CARGO_PEDIDO',
            id_order: p.id_order,
            id_user: p.id_user,
            note: `Pedido ${p.folio ?? p.id_order} (incluye IVA 16%)`,
        })
        return { charged: true as const, amount, balance: after }
    }

    /**
     * Devuelve el dinero de visitas que NO se hicieron (tareas canceladas por
     * cierre o eliminacion del pedido). Cada tarea se devuelve una sola vez
     * (lo garantiza el unique id_task + tipo en la base).
     */
    async refundTasks(tx: Tx, id_order: number, tasks: Array<{ id_task: number; id_request: number | null; id_store: number }>, id_user?: number | null, reason?: string) {
        if (tasks.length === 0) return { refunded: 0, count: 0 }
        const order = await tx.orders.findUnique({ where: { id_order }, select: { id_client: true, vc_folio: true, f_total: true } })
        if (!order) return { refunded: 0, count: 0 }
        const { mode, balance } = await lockClient(tx, order.id_client)
        if (mode !== PAYMENT_MODE.PREPAGO) return { refunded: 0, count: 0 }

        // Pedidos viejos se cobraron sin IVA: solo se devuelve con IVA si el cargo original lo llevaba.
        const cargo = await tx.client_balance_movements.findFirst({ where: { id_order, vc_type: 'CARGO_PEDIDO' }, select: { f_amount: true } })
        const conIva = !!cargo && Math.abs(Math.abs(Number(cargo.f_amount)) - addIva(Number(order.f_total)).total) < 0.02

        const items = await tx.order_items.findMany({
            where: { id_order },
            select: { id_request: true, id_store: true, f_value: true }
        })
        const valueByKey = new Map<string, number>()
        for (const it of items) valueByKey.set(`${it.id_request}:${it.id_store}`, Number(it.f_value))

        let current = balance
        let total = 0
        let count = 0
        for (const t of tasks) {
            if (t.id_request === null) continue
            const value = valueByKey.get(`${t.id_request}:${t.id_store}`)
            if (!value || value <= 0) continue
            const already = await tx.client_balance_movements.findFirst({
                where: { id_task: t.id_task, vc_type: 'DEVOLUCION' },
                select: { id_movement: true }
            })
            if (already) continue
            const refundValue = conIva ? addIva(value).total : value
            current = await applyMovement(tx, order.id_client, current, refundValue, {
                type: 'DEVOLUCION',
                id_order,
                id_task: t.id_task,
                id_user,
                note: `${reason ?? 'Visita no realizada'} (pedido ${order.vc_folio ?? id_order})`,
            })
            total = round2(total + refundValue)
            count++
        }
        return { refunded: total, count }
    }

    async getSummary(id_client: number) {
        const c = await prisma.clients.findUnique({
            where: { id_client },
            select: { id_client: true, name: true, vc_payment_mode: true, f_balance: true }
        })
        if (!c) throw new Error('Cliente no encontrado')
        const pending = await prisma.client_topups.count({ where: { id_client, id_status: TOPUP_STATUS.PENDIENTE } })
        return {
            id_client: c.id_client,
            name: c.name,
            vc_payment_mode: c.vc_payment_mode,
            f_balance: Number(c.f_balance),
            pending_topups: pending,
        }
    }

    private async userNames(ids: Array<number | null | undefined>): Promise<Map<number, string>> {
        const list = Array.from(new Set(ids.filter((x): x is number => typeof x === 'number' && x > 0)))
        const map = new Map<number, string>()
        if (!list.length) return map
        const users = await prisma.users.findMany({
            where: { id_user: { in: list } },
            select: { id_user: true, name: true, lastname: true },
        })
        for (const u of users) map.set(u.id_user, `${u.name} ${u.lastname}`.trim())
        return map
    }

    async getMovements(
        id_client: number | undefined,
        page = 1,
        limit = 30,
        f: { from?: string; to?: string; id_user?: number } = {},
        forClient = false,
    ) {
        const pg = Math.max(1, page)
        const lim = Math.min(100, Math.max(1, limit))
        const where: any = id_client ? { id_client } : {}
        if (f.id_user) {
            if (forClient && id_client) {
                const tops = await prisma.client_topups.findMany({
                    where: { id_client, id_user_requester: f.id_user },
                    select: { id_topup: true },
                })
                where.OR = [
                    { id_user: f.id_user, vc_type: { notIn: ['RECARGA', 'AJUSTE'] } },
                    { vc_type: 'RECARGA', id_topup: { in: tops.map(t => t.id_topup) } },
                ]
            } else {
                where.id_user = f.id_user
            }
        }
        const range: any = {}
        const reFecha = /^\d{4}-\d{2}-\d{2}$/
        if (f.from && reFecha.test(f.from)) {
            const d = new Date(`${f.from}T00:00:00-06:00`)
            if (!isNaN(d.getTime())) range.gte = d
        }
        if (f.to && reFecha.test(f.to)) {
            const d = new Date(`${f.to}T23:59:59.999-06:00`)
            if (!isNaN(d.getTime())) range.lte = d
        }
        if (range.gte || range.lte) where.dt_register = range
        const [rows, total] = await Promise.all([
            prisma.client_balance_movements.findMany({
                where,
                orderBy: { id_movement: 'desc' },
                skip: (pg - 1) * lim,
                take: lim,
                include: { client: { select: { name: true } } },
            }),
            prisma.client_balance_movements.count({ where }),
        ])
        // Para el cliente, en una recarga el "quien" es quien la pidio (su trabajador), no el master que la acredito.
        const reqByTopup = new Map<number, number | null>()
        if (forClient) {
            const topIds = rows
                .filter(r => r.vc_type === 'RECARGA' && r.id_topup)
                .map(r => r.id_topup as number)
            if (topIds.length) {
                const tops = await prisma.client_topups.findMany({
                    where: { id_topup: { in: topIds } },
                    select: { id_topup: true, id_user_requester: true },
                })
                for (const t of tops) reqByTopup.set(t.id_topup, t.id_user_requester)
            }
        }
        const actorOf = (r: { vc_type: string; id_topup: number | null; id_user: number | null }): number | null => {
            if (forClient && r.vc_type === 'AJUSTE') return null
            if (forClient && r.vc_type === 'RECARGA') return r.id_topup ? reqByTopup.get(r.id_topup) ?? null : null
            return r.id_user
        }
        const names = await this.userNames(rows.map(r => actorOf(r)))
        const data = rows.map(({ client, ...r }) => {
            const actor = actorOf(r)
            return {
                ...r,
                client_name: client?.name ?? null,
                user_name: actor ? names.get(actor) ?? null : null,
            }
        })
        return { data, meta: { total, page: pg, limit: lim, totalPages: Math.ceil(total / lim) } }
    }

    async getMovementFilters(id_client?: number, forClient = false) {
        const where: any = id_client ? { id_client } : {}
        if (forClient) {
            // Solo los usuarios del propio cliente: quienes pidieron recargas y quienes crearon/cancelaron ordenes.
            const [movs, reqs] = await Promise.all([
                prisma.client_balance_movements.groupBy({
                    by: ['id_user'],
                    where: { ...where, vc_type: { notIn: ['RECARGA', 'AJUSTE'] } },
                }),
                prisma.client_topups.groupBy({
                    by: ['id_user_requester'],
                    where: { ...where, id_status: 2 },
                }),
            ])
            const ids = Array.from(new Set([
                ...movs.map(m => m.id_user),
                ...reqs.map(q => q.id_user_requester),
            ].filter((x): x is number => !!x)))
            const names = await this.userNames(ids)
            const users = ids
                .map(id => ({ id_user: id, name: names.get(id) ?? `Usuario ${id}` }))
                .sort((a, b) => a.name.localeCompare(b.name))
            return { clients: [] as { id_client: number; name: string | null }[], users }
        }
        const pairs = await prisma.client_balance_movements.groupBy({ by: ['id_client', 'id_user'], where })
        const clientIds = Array.from(new Set(pairs.map(p => p.id_client)))
        const userIds = Array.from(new Set(pairs.map(p => p.id_user).filter((x): x is number => !!x)))
        const clients: { id_client: number; name: string | null }[] = clientIds.length
            ? await prisma.clients.findMany({
                where: { id_client: { in: clientIds } },
                select: { id_client: true, name: true },
                orderBy: { name: 'asc' },
            })
            : []
        const names = await this.userNames(userIds)
        const users = userIds
            .map(id => ({ id_user: id, name: names.get(id) ?? `Usuario ${id}` }))
            .sort((a, b) => a.name.localeCompare(b.name))
        return { clients, users }
    }

    async getBankInfo(): Promise<BankInfo> {
        const row = await prisma.app_settings.findUnique({ where: { vc_key: BANK_INFO_KEY } })
        if (!row) return { ...EMPTY_BANK }
        try {
            return { ...EMPTY_BANK, ...JSON.parse(row.vc_value) }
        } catch {
            return { ...EMPTY_BANK }
        }
    }

    async setBankInfo(input: Partial<BankInfo>): Promise<BankInfo> {
        const info: BankInfo = {
            bank: clean(input.bank, 100),
            holder: clean(input.holder, 150),
            clabe: clean(input.clabe, 30),
            account: clean(input.account, 30),
            instructions: clean(input.instructions, 500),
        }
        const value = JSON.stringify(info)
        await prisma.app_settings.upsert({
            where: { vc_key: BANK_INFO_KEY },
            update: { vc_value: value },
            create: { vc_key: BANK_INFO_KEY, vc_value: value },
        })
        return info
    }

    async createTopup(p: {
        id_client: number
        amount: number
        id_user?: number | null
        reference?: string | null
        file?: { buffer: Buffer; mimetype: string; originalname?: string } | null
    }) {
        const amount = round2(Number(p.amount))
        if (!Number.isFinite(amount) || amount < 1) throw new Error('El monto de la recarga debe ser de al menos $1.00')
        if (amount > 1000000) throw new Error('El monto de la recarga es demasiado alto')
        if (!p.file) throw new Error('Adjunta el comprobante de tu transferencia o deposito')

        const client = await prisma.clients.findUnique({ where: { id_client: p.id_client }, select: { vc_payment_mode: true } })
        if (!client) throw new Error('Cliente no encontrado')
        if (client.vc_payment_mode !== PAYMENT_MODE.PREPAGO) throw new Error('Esta cuenta no es de prepago')

        const topup = await prisma.client_topups.create({
            data: {
                id_client: p.id_client,
                f_amount: amount,
                vc_reference: p.reference ? clean(p.reference, 100) : null,
                id_user_requester: p.id_user ?? null,
            }
        })
        try {
            const { url } = await StorageService.uploadAsset({
                entity: 'client_topup',
                entity_id: topup.id_topup,
                buffer: p.file.buffer,
                mime: p.file.mimetype,
                id_client: p.id_client,
                id_user: p.id_user ?? null,
                originalName: p.file.originalname,
                optimize: p.file.mimetype.startsWith('image/'),
            })
            const saved = await prisma.client_topups.update({ where: { id_topup: topup.id_topup }, data: { vc_receipt_url: url } })
            notifyTopupCreated(p.id_client, amount)
            return saved
        } catch (error) {
            console.error('[Balance] Error al guardar comprobante de recarga:', (error as any)?.message)
            await prisma.client_topups.delete({ where: { id_topup: topup.id_topup } }).catch(() => undefined)
            throw new Error('No se pudo guardar el comprobante. Intenta de nuevo.')
        }
    }

    async listTopups(filters: { id_client?: number; id_status?: number; page?: number; limit?: number }) {
        const page = Math.max(1, filters.page ?? 1)
        const limit = Math.min(100, Math.max(1, filters.limit ?? 20))
        const where: any = {}
        if (filters.id_client !== undefined) where.id_client = filters.id_client
        if (filters.id_status !== undefined) where.id_status = filters.id_status
        const [rows, total] = await Promise.all([
            prisma.client_topups.findMany({
                where,
                orderBy: { dt_register: 'desc' },
                skip: (page - 1) * limit,
                take: limit,
                include: { client: { select: { id_client: true, name: true } } },
            }),
            prisma.client_topups.count({ where }),
        ])
        let urls = new Map<number, string>()
        try {
            urls = await resolveImages('client_topup', rows.map(r => r.id_topup))
        } catch (error) {
            console.error('[Balance] No se pudieron resolver los comprobantes:', (error as any)?.message)
        }
        const names = await this.userNames(rows.flatMap(r => [r.id_user_requester, r.id_user_validator]))
        const data = rows.map(r => ({
            ...r,
            vc_receipt_url: urls.get(r.id_topup) ?? r.vc_receipt_url,
            requester_name: r.id_user_requester ? names.get(r.id_user_requester) ?? null : null,
            validator_name: r.id_user_validator ? names.get(r.id_user_validator) ?? null : null,
        }))
        return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } }
    }

    async approveTopup(id_topup: number, id_user: number) {
        const approved = await prisma.$transaction(async (tx) => {
            const topup = await tx.client_topups.findUnique({ where: { id_topup } })
            if (!topup) throw new Error('Recarga no encontrada')
            const { balance } = await lockClient(tx, topup.id_client)
            const claim = await tx.client_topups.updateMany({
                where: { id_topup, id_status: TOPUP_STATUS.PENDIENTE },
                data: { id_status: TOPUP_STATUS.APROBADA, id_user_validator: id_user, dt_resolved: new Date() }
            })
            if (claim.count !== 1) throw new Error('Esta recarga ya fue resuelta')
            const after = await applyMovement(tx, topup.id_client, balance, Number(topup.f_amount), {
                type: 'RECARGA',
                id_topup,
                id_user,
                note: 'Recarga aprobada',
            })
            return { id_topup, id_client: topup.id_client, f_amount: Number(topup.f_amount), f_balance: after }
        })
        notifyTopupApproved(approved.id_client, approved.f_amount, Number(approved.f_balance))
        return approved
    }

    async rejectTopup(id_topup: number, id_user: number, reason: string) {
        const why = clean(reason, 255)
        if (!why) throw new Error('Escribe el motivo del rechazo')
        const res = await prisma.client_topups.updateMany({
            where: { id_topup, id_status: TOPUP_STATUS.PENDIENTE },
            data: { id_status: TOPUP_STATUS.RECHAZADA, vc_rejection_reason: why, id_user_validator: id_user, dt_resolved: new Date() }
        })
        if (res.count !== 1) throw new Error('Esta recarga no existe o ya fue resuelta')
        const rejected = await prisma.client_topups.findUnique({ where: { id_topup } })
        if (rejected) notifyTopupRejected(rejected.id_client, why)
        return rejected
    }

    /** Ajuste manual del master (suma o resta), siempre con motivo. */
    async adjustBalance(id_client: number, amount: number, note: string, id_user: number) {
        const delta = round2(Number(amount))
        if (!Number.isFinite(delta) || delta === 0) throw new Error('El ajuste debe ser distinto de cero')
        const why = clean(note, 200)
        if (!why) throw new Error('Escribe el motivo del ajuste')
        return await prisma.$transaction(async (tx) => {
            const { mode, balance } = await lockClient(tx, id_client)
            if (mode !== PAYMENT_MODE.PREPAGO) throw new Error('Solo se puede ajustar el saldo de clientes prepago')
            if (round2(balance + delta) < 0) throw new Error('El ajuste dejaria el saldo en negativo')
            const after = await applyMovement(tx, id_client, balance, delta, { type: 'AJUSTE', id_user, note: why })
            return { id_client, f_balance: after }
        })
    }

    /** Cambia un cliente entre CREDITO y PREPAGO (solo master). */
    async setPaymentMode(id_client: number, mode: string, id_user: number) {
        if (mode !== PAYMENT_MODE.CREDITO && mode !== PAYMENT_MODE.PREPAGO) throw new Error('Tipo de cliente invalido')
        return await prisma.$transaction(async (tx) => {
            const cur = await lockClient(tx, id_client)
            if (cur.mode === mode) return { id_client, vc_payment_mode: mode, f_balance: cur.balance }
            if (mode === PAYMENT_MODE.CREDITO && cur.balance > 0) {
                throw new Error(`El cliente tiene $${money(cur.balance)} a favor. Ajusta el saldo a 0 antes de pasarlo a credito.`)
            }
            await tx.clients.update({ where: { id_client }, data: { vc_payment_mode: mode } })
            await tx.user_logs.create({
                data: { log: `Cliente ${id_client}: tipo de cuenta cambiado de ${cur.mode} a ${mode}`, id_user }
            })
            return { id_client, vc_payment_mode: mode, f_balance: cur.balance }
        })
    }
}

export const balanceService = new BalanceService()
