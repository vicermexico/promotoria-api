import { prisma } from '../../../core/prisma'
import { generateFolio } from '../../../services/folio.service'
import { ORDER_STATUS } from '../../../core/constants/status.constants'
import { CLIENT_CHARGE_STATUS } from '../finances.constants'
import {
    GenerateChargesDTO,
    ChargeFiltersDTO,
    InvoiceFiltersDTO,
    UpdateInvoicePaymentDTO,
    UpdateInvoiceStatusDTO,
    UpdateInvoiceDueDateDTO,
} from './client-charges.dto'

interface EligibleTask {
  id_task: number
  id_order: number
  id_client: number
  id_store: number
  f_amount: number
}

export class ClientCharges {
    private async findEligibleTasks(dt_start: Date, dt_end: Date, id_client?: number): Promise<EligibleTask[]> {
        const tasks = await prisma.tasks.findMany({
            where: {
                // OJO: el enum TASK_STATUS del backend casi no se usa en la práctica.
                // El estatus real "Terminada con éxito" que escribe la app móvil es el 7
                // (ver comentario en webs/promotoria-saas/src/modules/tareas/utils.ts).
                id_status: 7,
                id_invoice: null,
                id_request: { not: null },
                dt_update: { gte: dt_start, lte: dt_end },
                order: { id_status: ORDER_STATUS.CERRADO },
                ...(id_client !== undefined ? { id_client } : {}),
            },
            select: { id_task: true, id_order: true, id_client: true, id_request: true, id_store: true }
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
            const f_amount = valueMap.get(key)
            if (f_amount === undefined) {
                console.warn(`No se encontró order_item para la tarea ${t.id_task} (${key}), se excluye del corte`)
                continue
            }
            eligible.push({ id_task: t.id_task, id_order: t.id_order, id_client: t.id_client, id_store: t.id_store, f_amount })
        }
        return eligible
    }

    private groupByClientAndOrder(tasks: EligibleTask[]) {
        const byClient = new Map<number, Map<number, EligibleTask[]>>()
        for (const t of tasks) {
            if (!byClient.has(t.id_client)) byClient.set(t.id_client, new Map())
            const byOrder = byClient.get(t.id_client)!
            if (!byOrder.has(t.id_order)) byOrder.set(t.id_order, [])
            byOrder.get(t.id_order)!.push(t)
        }
        return byClient
    }

    async preview(input: GenerateChargesDTO) {
        const tasks = await this.findEligibleTasks(input.dt_start, input.dt_end, input.id_client)
        const byClient = this.groupByClientAndOrder(tasks)

        const clients = [] as Array<{ id_client: number, f_total: number, orders: Array<{ id_order: number, f_amount: number, tasks: Array<{ id_task: number, f_amount: number }> }> }>
        for (const [id_client, byOrder] of byClient) {
            const orders = [] as typeof clients[number]['orders']
            let clientTotal = 0
            for (const [id_order, orderTasks] of byOrder) {
                const orderTotal = orderTasks.reduce((sum, t) => sum + t.f_amount, 0)
                clientTotal += orderTotal
                orders.push({
                    id_order,
                    f_amount: orderTotal,
                    tasks: orderTasks.map(t => ({ id_task: t.id_task, f_amount: t.f_amount }))
                })
            }
            clients.push({ id_client, f_total: clientTotal, orders })
        }
        return { clients }
    }

    async generate(input: GenerateChargesDTO) {
        const tasks = await this.findEligibleTasks(input.dt_start, input.dt_end, input.id_client)
        const byClient = this.groupByClientAndOrder(tasks)

        const createdCharges: Awaited<ReturnType<typeof prisma.client_charges.create>>[] = []
        for (const [id_client, byOrder] of byClient) {
            const charge = await prisma.$transaction(async (tx) => {
                const allTasksForClient: EligibleTask[] = []
                for (const orderTasks of byOrder.values()) allTasksForClient.push(...orderTasks)
                const f_total = allTasksForClient.reduce((sum, t) => sum + t.f_amount, 0)

                const vc_folio = await generateFolio(tx, id_client, 'client_charge')

                const charge = await tx.client_charges.create({
                    data: {
                        id_client,
                        vc_folio,
                        dt_start: input.dt_start,
                        dt_end: input.dt_end,
                        f_total,
                        id_user_creator: input.id_user_creator,
                    }
                })

                for (const [id_order, orderTasks] of byOrder) {
                    const orderTotal = orderTasks.reduce((sum, t) => sum + t.f_amount, 0)
                    const vc_invoice_folio = await generateFolio(tx, id_client, 'invoices')

                    await tx.client_charge_orders.create({
                        data: {
                            id_charge: charge.id_charge,
                            id_order,
                            vc_folio: vc_invoice_folio,
                            f_amount: orderTotal,
                            id_status: CLIENT_CHARGE_STATUS.PENDIENTE_PAGO,
                            dt_due: input.dt_due,
                        }
                    })
                    for (const t of orderTasks) {
                        await tx.client_charge_tasks.create({
                            data: { id_charge: charge.id_charge, id_order, id_task: t.id_task, f_amount: t.f_amount }
                        })
                    }
                }

                const taskIds = allTasksForClient.map(t => t.id_task)
                const updateResult = await tx.tasks.updateMany({
                    where: { id_task: { in: taskIds }, id_invoice: null },
                    data: { id_invoice: charge.id_charge }
                })
                if (updateResult.count !== taskIds.length) {
                    throw new Error('Una o más tareas ya fueron tomadas por otro corte, intenta de nuevo')
                }

                await tx.client_charge_logs.create({
                    data: {
                        id_charge: charge.id_charge,
                        id_user: input.id_user_creator,
                        vc_log: `Corte generado con ${byOrder.size} factura(s) y ${taskIds.length} tarea(s) por $${f_total.toFixed(2)}`,
                    }
                })

                return charge
            })
            createdCharges.push(charge)
        }
        return createdCharges
    }

    async list(filters: ChargeFiltersDTO) {
        const page = filters.page ?? 1
        const limit = filters.limit ?? 20
        const skip = (page - 1) * limit

        const where: any = {}
        if (filters.id_client !== undefined) where.id_client = filters.id_client
        if (filters.vc_folio) where.vc_folio = { contains: filters.vc_folio }
        if (filters.dt_start || filters.dt_end) {
            where.dt_start = {}
            if (filters.dt_start) where.dt_start.gte = filters.dt_start
            if (filters.dt_end) where.dt_start.lte = filters.dt_end
        }

        const [data, total] = await Promise.all([
            prisma.client_charges.findMany({ where, skip, take: limit, orderBy: { dt_register: 'desc' } }),
            prisma.client_charges.count({ where })
        ])

        return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } }
    }

    async getRaw(id_charge: number) {
        return await prisma.client_charges.findUnique({ where: { id_charge } })
    }

    async getById(id_charge: number) {
        const charge = await prisma.client_charges.findUnique({
            where: { id_charge },
            include: {
                charge_orders: { include: { order: true } },
                charge_tasks: {
                    include: {
                        task: {
                            include: {
                                store: true,
                                request: true,
                                promoter: { select: { id: true, name: true, lastname: true, email: true, phone: true } }
                            }
                        }
                    }
                }
            }
        })
        if (!charge) return null

        const logs = await prisma.client_charge_logs.findMany({ where: { id_charge }, orderBy: { dt_register: 'desc' } })

        return { ...charge, logs }
    }

    async listInvoices(filters: InvoiceFiltersDTO) {
        const page = filters.page ?? 1
        const limit = filters.limit ?? 20
        const skip = (page - 1) * limit

        const where: any = {}
        if (filters.id_status !== undefined) where.id_status = filters.id_status
        if (filters.vc_folio) where.vc_folio = { contains: filters.vc_folio }
        if (filters.id_client !== undefined || filters.dt_start || filters.dt_end) {
            where.charge = {}
            if (filters.id_client !== undefined) where.charge.id_client = filters.id_client
            if (filters.dt_start || filters.dt_end) {
                where.charge.dt_start = {}
                if (filters.dt_start) where.charge.dt_start.gte = filters.dt_start
                if (filters.dt_end) where.charge.dt_start.lte = filters.dt_end
            }
        }
        // Vencida = sigue pendiente de pago u observada, y ya pasó su fecha límite
        if (filters.b_overdue) {
            where.id_status = { in: [CLIENT_CHARGE_STATUS.PENDIENTE_PAGO, CLIENT_CHARGE_STATUS.OBSERVADO] }
            where.dt_due = { lt: new Date() }
        }

        const [data, total] = await Promise.all([
            prisma.client_charge_orders.findMany({
                where,
                skip,
                take: limit,
                orderBy: { dt_register: 'desc' },
                include: { charge: true, order: true }
            }),
            prisma.client_charge_orders.count({ where })
        ])

        return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } }
    }

    async getInvoiceRaw(id: number) {
        return await prisma.client_charge_orders.findUnique({ where: { id }, include: { charge: true } })
    }

    async getInvoiceById(id: number) {
        const invoice = await prisma.client_charge_orders.findUnique({
            where: { id },
            include: { charge: true, order: true }
        })
        if (!invoice) return null

        const [tasks, evidences, logs] = await Promise.all([
            prisma.client_charge_tasks.findMany({
                where: { id_charge: invoice.id_charge, id_order: invoice.id_order },
                include: {
                    task: {
                        include: {
                            store: true,
                            request: true,
                            promoter: { select: { id: true, name: true, lastname: true, email: true, phone: true } }
                        }
                    }
                }
            }),
            prisma.assets.findMany({ where: { entity_type: 'client_charge_order', entity_id: id, is_active: true } }),
            prisma.client_charge_logs.findMany({ where: { id_charge: invoice.id_charge }, orderBy: { dt_register: 'desc' } })
        ])

        return { ...invoice, tasks, evidences, logs }
    }

    async getPendingOrders(id_client: number) {
        const tasks = await prisma.tasks.findMany({
            where: {
                id_status: 7,
                id_invoice: null,
                id_request: { not: null },
                id_client,
                order: { id_status: ORDER_STATUS.CERRADO },
            },
            include: { order: true }
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

        const byOrder = new Map<number, { order: any, f_amount: number, task_count: number }>()
        for (const t of tasks) {
            const key = `${t.id_order}:${t.id_request}:${t.id_store}`
            const f_amount = valueMap.get(key)
            if (f_amount === undefined) {
                console.warn(`No se encontró order_item para la tarea ${t.id_task} (${key}), se excluye de pendientes por facturar`)
                continue
            }
            if (!byOrder.has(t.id_order)) {
                byOrder.set(t.id_order, { order: t.order, f_amount: 0, task_count: 0 })
            }
            const entry = byOrder.get(t.id_order)!
            entry.f_amount += f_amount
            entry.task_count += 1
        }

        return [...byOrder.entries()].map(([id_order, data]) => ({
            id_order,
            f_amount: data.f_amount,
            task_count: data.task_count,
            order: data.order,
        }))
    }

    async updateInvoiceDueDate(id: number, dt_due: Date, id_user: number) {
        const invoice = await prisma.client_charge_orders.findUnique({ where: { id } })
        if (!invoice) throw new Error('Factura no encontrada')

        const updated = await prisma.client_charge_orders.update({
            where: { id },
            data: { dt_due }
        })

        await prisma.client_charge_logs.create({
            data: {
                id_charge: invoice.id_charge,
                id_user,
                vc_log: `Fecha límite de pago de la factura ${invoice.vc_folio ?? invoice.id} actualizada a ${dt_due.toISOString()}`
            }
        })

        return updated
    }

    async submitInvoicePayment(id: number, data: UpdateInvoicePaymentDTO, id_user: number) {
        return await prisma.$transaction(async (tx) => {
            const invoice = await tx.client_charge_orders.findUnique({ where: { id } })
            if (!invoice) throw new Error('Factura no encontrada')
            if (![CLIENT_CHARGE_STATUS.PENDIENTE_PAGO, CLIENT_CHARGE_STATUS.OBSERVADO].includes(invoice.id_status as any)) {
                throw new Error('La factura no está en un estatus que permita subir el comprobante de pago')
            }

            const updated = await tx.client_charge_orders.update({
                where: { id },
                data: {
                    dt_payment: data.dt_payment,
                    vc_payment_method: data.vc_payment_method,
                    id_status: CLIENT_CHARGE_STATUS.EN_VALIDACION,
                }
            })

            await tx.client_charge_logs.create({
                data: {
                    id_charge: invoice.id_charge,
                    id_user,
                    vc_log: `Cliente subió comprobante de pago de la factura ${invoice.vc_folio ?? invoice.id}`
                }
            })

            return updated
        })
    }

    async updateInvoiceStatus(id: number, data: UpdateInvoiceStatusDTO, id_user: number) {
        return await prisma.$transaction(async (tx) => {
            const invoice = await tx.client_charge_orders.findUnique({ where: { id } })
            if (!invoice) throw new Error('Factura no encontrada')

            if (data.action === 'approve') {
                if (invoice.id_status !== CLIENT_CHARGE_STATUS.EN_VALIDACION) {
                    throw new Error('Solo se puede aprobar una factura en validación')
                }
                const updated = await tx.client_charge_orders.update({
                    where: { id },
                    data: { id_status: CLIENT_CHARGE_STATUS.PAGADO, id_user_validator: id_user }
                })
                await tx.client_charge_logs.create({
                    data: { id_charge: invoice.id_charge, id_user, vc_log: `Factura ${invoice.vc_folio ?? invoice.id} aprobada y cerrada` }
                })
                return updated
            }

            if (data.action === 'reject') {
                if (invoice.id_status !== CLIENT_CHARGE_STATUS.EN_VALIDACION) {
                    throw new Error('Solo se puede rechazar una factura en validación')
                }
                const updated = await tx.client_charge_orders.update({
                    where: { id },
                    data: {
                        id_status: CLIENT_CHARGE_STATUS.OBSERVADO,
                        vc_rejection_reason: data.vc_rejection_reason,
                        id_user_validator: id_user,
                    }
                })
                await tx.client_charge_logs.create({
                    data: { id_charge: invoice.id_charge, id_user, vc_log: `Factura ${invoice.vc_folio ?? invoice.id} observada: ${data.vc_rejection_reason}` }
                })
                return updated
            }

            if (![CLIENT_CHARGE_STATUS.PENDIENTE_PAGO, CLIENT_CHARGE_STATUS.OBSERVADO].includes(invoice.id_status as any)) {
                throw new Error('Solo se puede cancelar una factura pendiente de pago u observada')
            }
            const updated = await tx.client_charge_orders.update({
                where: { id },
                data: { id_status: CLIENT_CHARGE_STATUS.CANCELADO }
            })

            const orderTasks = await tx.client_charge_tasks.findMany({
                where: { id_charge: invoice.id_charge, id_order: invoice.id_order },
                select: { id_task: true }
            })
            const taskIds = orderTasks.map(t => t.id_task)
            if (taskIds.length > 0) {
                await tx.tasks.updateMany({
                    where: { id_task: { in: taskIds }, id_invoice: invoice.id_charge },
                    data: { id_invoice: null }
                })
            }

            await tx.client_charge_logs.create({
                data: { id_charge: invoice.id_charge, id_user, vc_log: `Factura ${invoice.vc_folio ?? invoice.id} cancelada, tareas liberadas` }
            })
            return updated
        })
    }
}
