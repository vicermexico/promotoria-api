import { prisma } from '../../../core/prisma'
import { generateFolio } from '../../../services/folio.service'
import { PROMOTER_PAYMENT_STATUS } from '../finances.constants'
import { GeneratePaymentsDTO, PaymentFiltersDTO, UpdatePaymentPaymentDTO } from './promoter-payments.dto'
import { EncryptionService } from '../../../services/encryption.service'

interface EligibleTask {
  id_task: number
  id_order: number
  id_promoter: number
  id_store: number
  f_amount: number
}

export class PromoterPayments {
    private async getSettings() {
        const settings = await prisma.finance_settings.findUnique({ where: { id_setting: 1 } })
        if (!settings) throw new Error('finance_settings no está inicializado')
        return settings
    }

    private async findEligibleTasks(dt_start: Date, dt_end: Date, commissionPct: number, id_promoter?: number): Promise<EligibleTask[]> {
        const tasks = await prisma.tasks.findMany({
            where: {
                // OJO: el estatus real "Terminada con éxito" es el 7, no el 6
                // (el enum TASK_STATUS del backend casi no se usa en la práctica,
                // ver fuente de verdad en webs/promotoria-saas/.../tareas/utils.ts).
                id_status: 7,
                id_promoter_payment: null,
                id_promoter: { not: null },
                id_request: { not: null },
                dt_update: { gte: dt_start, lte: dt_end },
                ...(id_promoter !== undefined ? { id_promoter } : {}),
            },
            select: { id_task: true, id_order: true, id_promoter: true, id_request: true, id_store: true }
        })
        if (tasks.length === 0) return []

        const orderIds = [...new Set(tasks.map(t => t.id_order))]
        const orderItems = await prisma.order_items.findMany({
            where: { id_order: { in: orderIds } },
            select: { id_order: true, id_request: true, id_store: true, f_value: true }
        })
        const valueMap = new Map<string, number>()
        for (const oi of orderItems) {
            valueMap.set(`${oi.id_order}:${oi.id_request}:${oi.id_store}`, Number(oi.f_value))
        }

        const eligible: EligibleTask[] = []
        for (const t of tasks) {
            const key = `${t.id_order}:${t.id_request}:${t.id_store}`
            const baseValue = valueMap.get(key)
            if (baseValue === undefined) {
                console.warn(`No se encontró order_item para la tarea ${t.id_task} (${key}), se excluye del pago`)
                continue
            }
            const f_amount = Math.round(baseValue * (commissionPct / 100) * 100) / 100
            eligible.push({ id_task: t.id_task, id_order: t.id_order, id_promoter: t.id_promoter!, id_store: t.id_store, f_amount })
        }
        return eligible
    }

    private groupByPromoter(tasks: EligibleTask[]) {
        const byPromoter = new Map<number, EligibleTask[]>()
        for (const t of tasks) {
            if (!byPromoter.has(t.id_promoter)) byPromoter.set(t.id_promoter, [])
            byPromoter.get(t.id_promoter)!.push(t)
        }
        return byPromoter
    }

    async preview(input: GeneratePaymentsDTO) {
        const settings = await this.getSettings()
        const commissionPct = Number(settings.f_promoter_commission_percentage)
        if (commissionPct <= 0) {
            throw new Error('Configura el porcentaje de comisión del promotor en finances/settings antes de generar pagos')
        }
        const tasks = await this.findEligibleTasks(input.dt_start, input.dt_end, commissionPct, input.id_promoter)
        const byPromoter = this.groupByPromoter(tasks)

        const promoters = [] as Array<{ id_promoter: number, f_total: number, tasks: Array<{ id_task: number, f_amount: number }> }>
        for (const [id_promoter, promoterTasks] of byPromoter) {
            const f_total = promoterTasks.reduce((sum, t) => sum + t.f_amount, 0)
            promoters.push({ id_promoter, f_total, tasks: promoterTasks.map(t => ({ id_task: t.id_task, f_amount: t.f_amount })) })
        }
        return { promoters }
    }

    async generate(input: GeneratePaymentsDTO) {
        const settings = await this.getSettings()
        const commissionPct = Number(settings.f_promoter_commission_percentage)
        if (commissionPct <= 0) {
            throw new Error('Configura el porcentaje de comisión del promotor en finances/settings antes de generar pagos')
        }
        const tasks = await this.findEligibleTasks(input.dt_start, input.dt_end, commissionPct, input.id_promoter)
        const byPromoter = this.groupByPromoter(tasks)

        const createdPayments: Awaited<ReturnType<typeof prisma.promoter_payments.create>>[] = []
        for (const [id_promoter, promoterTasks] of byPromoter) {
            const payment = await prisma.$transaction(async (tx) => {
                const f_total = promoterTasks.reduce((sum, t) => sum + t.f_amount, 0)
                const vc_folio = await generateFolio(tx, settings.id_system_client, 'promoter_payment')

                const payment = await tx.promoter_payments.create({
                    data: {
                        id_promoter,
                        vc_folio,
                        dt_start: input.dt_start,
                        dt_end: input.dt_end,
                        f_total,
                        id_status: PROMOTER_PAYMENT_STATUS.POR_PAGAR,
                        id_user_creator: input.id_user_creator,
                    }
                })

                for (const t of promoterTasks) {
                    await tx.promoter_payment_tasks.create({
                        data: { id_payment: payment.id_payment, id_task: t.id_task, f_amount: t.f_amount }
                    })
                }

                const taskIds = promoterTasks.map(t => t.id_task)
                const updateResult = await tx.tasks.updateMany({
                    where: { id_task: { in: taskIds }, id_promoter_payment: null },
                    data: { id_promoter_payment: payment.id_payment }
                })
                if (updateResult.count !== taskIds.length) {
                    throw new Error('Una o más tareas ya fueron tomadas por otro pago, intenta de nuevo')
                }

                await tx.promoter_payment_logs.create({
                    data: {
                        id_payment: payment.id_payment,
                        id_user: input.id_user_creator,
                        vc_log: `Pago generado con ${taskIds.length} tarea(s) por $${f_total.toFixed(2)}`,
                    }
                })

                return payment
            })
            createdPayments.push(payment)
        }
        return createdPayments
    }

    async list(filters: PaymentFiltersDTO) {
        const page = filters.page ?? 1
        const limit = filters.limit ?? 20
        const skip = (page - 1) * limit

        const where: any = {}
        if (filters.id_promoter !== undefined) where.id_promoter = filters.id_promoter
        if (filters.id_status !== undefined) where.id_status = filters.id_status
        if (filters.vc_folio) where.vc_folio = { contains: filters.vc_folio }
        if (filters.dt_start || filters.dt_end) {
            where.dt_start = {}
            if (filters.dt_start) where.dt_start.gte = filters.dt_start
            if (filters.dt_end) where.dt_start.lte = filters.dt_end
        }

        const [data, total] = await Promise.all([
            prisma.promoter_payments.findMany({
                where, skip, take: limit, orderBy: { dt_register: 'desc' },
                include: { promoter: { select: { id: true, name: true, lastname: true, phone: true } } }
            }),
            prisma.promoter_payments.count({ where })
        ])

        return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } }
    }

    async getRaw(id_payment: number) {
        return await prisma.promoter_payments.findUnique({ where: { id_payment } })
    }

    async getById(id_payment: number) {
        const payment = await prisma.promoter_payments.findUnique({
            where: { id_payment },
            include: {
                payment_tasks: { include: { task: { include: { store: true, request: true, order: true } } } },
                promoter: {
                    select: {
                        id: true, name: true, lastname: true, email: true, phone: true,
                        promoter_bank_accounts: { where: { dt_deleted: null } }
                    }
                }
            }
        })
        if (!payment) return null

        // Las cuentas bancarias se guardan cifradas (AES-256); nunca se
        // exponen completas aqui. Solo los ultimos 4 digitos. El numero
        // completo se obtiene aparte, bajo demanda, via el endpoint
        // /bank-accounts/:id/reveal (auditado), justo antes de hacer la
        // transferencia manual.
        const maskedPromoter = {
            ...payment.promoter,
            promoter_bank_accounts: payment.promoter.promoter_bank_accounts.map(acc => ({
                ...acc,
                clabe: acc.clabe ? EncryptionService.decryptToMasked(acc.clabe) : null,
                card_number: acc.card_number ? EncryptionService.decryptToMasked(acc.card_number) : null,
            })),
        }

        const [evidences, logs] = await Promise.all([
            prisma.assets.findMany({ where: { entity_type: 'promoter_payment', entity_id: id_payment, is_active: true } }),
            prisma.promoter_payment_logs.findMany({ where: { id_payment }, orderBy: { dt_register: 'desc' } })
        ])

        return { ...payment, promoter: maskedPromoter, evidences, logs }
    }

    async submitPayment(id_payment: number, data: UpdatePaymentPaymentDTO, id_user: number) {
        return await prisma.$transaction(async (tx) => {
            const payment = await tx.promoter_payments.findUnique({ where: { id_payment } })
            if (!payment) throw new Error('Pago no encontrado')
            if (payment.id_status !== PROMOTER_PAYMENT_STATUS.POR_PAGAR) {
                throw new Error('El pago no está en un estatus que permita registrarlo')
            }

            const bankAccount = await tx.promoter_bank_accounts.findFirst({
                where: { id: data.id_bank_account, id_promoter: payment.id_promoter, dt_deleted: null }
            })
            if (!bankAccount) throw new Error('La cuenta bancaria no existe o no pertenece a este promotor')

            const updated = await tx.promoter_payments.update({
                where: { id_payment },
                data: {
                    dt_payment: data.dt_payment,
                    id_bank_account: data.id_bank_account,
                    vc_notes: data.vc_notes,
                    id_status: PROMOTER_PAYMENT_STATUS.PAGADO,
                    id_user_payer: id_user,
                }
            })

            await tx.promoter_payment_logs.create({
                data: { id_payment, id_user, vc_log: 'Pago registrado por el super usuario' }
            })

            return updated
        })
    }

    async cancel(id_payment: number, id_user: number) {
        return await prisma.$transaction(async (tx) => {
            const payment = await tx.promoter_payments.findUnique({ where: { id_payment } })
            if (!payment) throw new Error('Pago no encontrado')
            if (payment.id_status !== PROMOTER_PAYMENT_STATUS.POR_PAGAR) {
                throw new Error('Solo se puede cancelar un pago por pagar')
            }
            const updated = await tx.promoter_payments.update({
                where: { id_payment },
                data: { id_status: PROMOTER_PAYMENT_STATUS.CANCELADO }
            })
            await tx.tasks.updateMany({ where: { id_promoter_payment: id_payment }, data: { id_promoter_payment: null } })
            await tx.promoter_payment_logs.create({ data: { id_payment, id_user, vc_log: 'Pago cancelado, tareas liberadas' } })
            return updated
        })
    }
}
