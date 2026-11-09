import { prisma } from '../../core/prisma'
import { CreateTaskDTO, UpdateTaskDTO, AnswerItemDTO } from './tasks.dtos'
import { generateFolio } from '../../services/folio.service'
import { resolveImages } from '../../core/asset-resolver'
import { haversineMeters } from '../../queues/helpers/haversine'
import { StorageService } from '../../services/storage.service'
import { taskRankingQueue } from '../../core/bullmq/queues'
import { NotificationService } from '../../services/notification.service'
import { balanceService } from '../balance/balance.service'
import { promoterRule, promoterAmount } from '../finances/commission'
import { notifyTaskReadyForReview, notifyTaskDisputed, notifyDisputeConfirmed, notifyDisputeUpheld } from '../user-push/user-push.events'

export class Task {

    /**
     * Calcula cuanto le corresponde de verdad al promotor por un grupo de
     * tareas, usando el mismo porcentaje configurado en Finanzas y la misma
     * formula que se usa al generar pagos reales (ver
     * promoter-payments.service.ts:findEligibleTasks). Antes de esto, las
     * pantallas de "cuanto genera" caian en un valor de respaldo (el total
     * cobrado al cliente completo), porque nunca se calculaba esto aqui.
     */
    private async attachPromoterEarnings<
        T extends { id_task: number; id_order: number; id_request: number | null; id_store: number }
    >(tasks: T[]): Promise<Map<number, number>> {
        const earningsByTask = new Map<number, number>()
        if (tasks.length === 0) return earningsByTask

        const settings = await prisma.finance_settings.findUnique({ where: { id_setting: 1 } })
        const rule = promoterRule(settings)
        if (rule.value <= 0) return earningsByTask

        const orderIds = [...new Set(tasks.map(t => t.id_order))]
        const orderItems = await prisma.order_items.findMany({
            where: { id_order: { in: orderIds } },
            select: { id_order: true, id_request: true, id_store: true, f_value: true }
        })
        const valueMap = new Map<string, number>()
        for (const oi of orderItems) {
            valueMap.set(`${oi.id_order}:${oi.id_request}:${oi.id_store}`, Number(oi.f_value))
        }

        for (const t of tasks) {
            if (t.id_request === null) continue
            const baseValue = valueMap.get(`${t.id_order}:${t.id_request}:${t.id_store}`)
            if (baseValue === undefined) continue
            earningsByTask.set(t.id_task, promoterAmount(baseValue, rule))
        }
        return earningsByTask
    }

    async create(data: CreateTaskDTO) {
        const task = await prisma.$transaction(async (tx) => {
            const vc_folio = await generateFolio(tx, data.id_client, 'tasks')

            return tx.tasks.create({
                data: {
                    id_client: data.id_client,
                    id_order: data.id_order,
                    id_store: data.id_store,
                    id_request: data.id_request,
                    vc_folio,
                }
            })
        })

        // Dispara el primer ciclo de ranking/notificación de inmediato, en vez
        // de esperar al siguiente tick del scheduler (cada 30 min en prod / 1
        // min en dev). Mismo job y mismo jobId determinístico que usa
        // `schedulerWorker`, así que si el scheduler también la encuentra antes
        // de que este ciclo termine, BullMQ deduplica por jobId y no se manda
        // la notificación dos veces para el mismo ciclo.
        try {
            await taskRankingQueue.add('rank_promoters', {
                id_task: task.id_task,
                id_store: task.id_store,
                cycle: task.i_current_cycle
            }, {
                jobId: `rank_task_${task.id_task}_cycle_${task.i_current_cycle}`
            })
            console.log(`[Task] Tarea ${task.id_task} (folio ${task.vc_folio}) encolada para ranqueo inmediato, ciclo ${task.i_current_cycle}.`)
        } catch (error) {
            console.error(`[Task] Error al encolar ranking inmediato para tarea ${task.id_task}:`, error)
        }

        return task
    }

    async getById(id_task: number) {
        const task = await prisma.tasks.findUnique({
            where: { id_task },
            include: {
                client: { select: { id_client: true, name: true } },
                order: { select: { id_order: true, vc_folio: true, f_total: true, id_status: true } },
                store: { select: { id_store: true, name: true, store_code: true } },
                promoter: { select: { id: true, name: true, lastname: true, phone: true, email: true } },
                request: { select: { id_request: true, vc_folio: true, vc_name: true, url_rack_image: true, f_value: true, b_preorder: true } }
            }
        })
        if (!task) return null

        const [storeAddress, requestAssets, clientLogo] = await Promise.all([
            prisma.addresses.findFirst({
                where: { entity_type: 'store', entity_id: task.id_store, is_active: true },
                select: {
                    street: true, ext_number: true, int_number: true,
                    neighborhood: true, postal_code: true, address_references: true,
                    latitude: true, longitude: true,
                    city: { select: { id: true, name: true } },
                    state: { select: { id: true, name: true } },
                }
            }),
            task.id_request ? resolveImages('request', [task.id_request]) : Promise.resolve(new Map<number, string>()),
            task.id_client ? resolveImages('client_logo', [task.id_client]) : Promise.resolve(new Map<number, string>()),
        ])

        const request = task.request && task.id_request
            ? { ...task.request, url_rack_image: requestAssets.get(task.id_request) ?? task.request.url_rack_image }
            : task.request;

        const client = task.client
            ? { ...task.client, logo_url: clientLogo.get(task.id_client) ?? null }
            : task.client;

        return { ...task, request, client, storeAddress }
    }

    async getAll(filters?: {
        id_client?: number; id_order?: number; id_promoter?: number; id_status?: number
        id_request?: number; id_store?: number; dt_from?: string; dt_to?: string
        page?: number; limit?: number
    }) {
        const page = filters?.page ?? 1
        const limit = filters?.limit ?? 20
        const skip = (page - 1) * limit

        const where: any = {}
        if (filters?.id_client) where.id_client = filters.id_client
        if (filters?.id_order) where.id_order = filters.id_order
        if (filters?.id_promoter !== undefined) where.id_promoter = filters.id_promoter
        if (filters?.id_status !== undefined) where.id_status = filters.id_status
        if (filters?.id_request) where.id_request = filters.id_request
        if (filters?.id_store) where.id_store = filters.id_store
        if (filters?.dt_from || filters?.dt_to) {
            where.dt_register = {}
            if (filters.dt_from) where.dt_register.gte = new Date(filters.dt_from)
            if (filters.dt_to) {
                const endOfDay = new Date(filters.dt_to)
                endOfDay.setHours(23, 59, 59, 999)
                where.dt_register.lte = endOfDay
            }
        }

        const [tasks, total] = await Promise.all([
            prisma.tasks.findMany({
                where,
                skip,
                take: limit,
                include: {
                    client: { select: { id_client: true, name: true, vc_initialism: true } },
                    order: { select: { id_order: true, vc_folio: true, f_total: true } },
                    store: { select: { id_store: true, name: true } },
                    promoter: { select: { id: true, name: true, lastname: true, phone: true } },
                    request: { select: { id_request: true, vc_folio: true, vc_name: true, f_value: true } }
                },
                orderBy: { dt_register: 'desc' }
            }),
            prisma.tasks.count({ where })
        ])

        const earningsByTask = await this.attachPromoterEarnings(tasks)
        const tasksWithEarnings = tasks.map(t => ({
            ...t,
            promoter_earnings: earningsByTask.get(t.id_task) ?? null,
        }))

        return {
            data: tasksWithEarnings,
            meta: { total, page, limit, totalPages: Math.ceil(total / limit) }
        }
    }

    /**
     * Resumen de cuantas tareas de un cliente caen en cada una de las 4
     * categorias que ve el cliente en el listado de Pedidos, antes de
     * entrar al detalle: Pendientes (nadie la ha tomado), En progreso
     * (un promotor ya la acepto y la esta trabajando), Completadas (el
     * promotor ya la termino, esperando que el cliente la revise) y
     * Finalizadas (el cliente ya la aprobo).
     */
    async getStatusSummary(id_client: number) {
        const counts = await prisma.tasks.groupBy({
            by: ['id_status'],
            where: { id_client },
            _count: { id_task: true },
        })

        const countFor = (statuses: number[]) =>
            counts.filter(c => statuses.includes(c.id_status)).reduce((sum, c) => sum + c._count.id_task, 0)

        return {
            pendientes: countFor([1]),
            en_progreso: countFor([2, 3, 4]),
            completadas: countFor([6]),
            finalizadas: countFor([7]),
        }
    }

    async getTasksByPromoter(id_promoter: number, id_status?: number | number[]) {
        const where: any = { id_promoter }
        if (id_status !== undefined) {
            where.id_status = Array.isArray(id_status) ? { in: id_status } : id_status
        } else {
            where.id_status = { in: [1, 2, 3] }
        }

        const tasks = await prisma.tasks.findMany({
            where,
            select: {
                id_task: true, vc_folio: true, id_status: true, dt_register: true, i_notification_count: true,
                id_request: true, id_promoter_payment: true, id_order: true, id_store: true,
                store: {
                    select: { id_store: true, name: true, store_code: true }
                },
                request: {
                    select: { id_request: true, vc_folio: true, vc_name: true, url_rack_image: true }
                },
                order: {
                    select: { id_order: true, vc_folio: true, f_total: true }
                },
                client: {
                    select: { id_client: true, name: true }
                }
            },
            orderBy: { dt_register: 'desc' }
        })

        const requestIds = tasks.filter(t => t.id_request).map(t => t.id_request!);
        const requestAssets = await resolveImages('request', requestIds);
        const earningsByTask = await this.attachPromoterEarnings(tasks)

        return tasks.map(t => ({
            ...t,
            promoter_earnings: earningsByTask.get(t.id_task) ?? null,
            request: t.request
                ? { ...t.request, url_rack_image: requestAssets.get(t.request.id_request) ?? t.request.url_rack_image }
                : null,
        }));
    }

    async assignPromoter(id_task: number, id_promoter: number) {
        const task = await prisma.tasks.findUnique({ where: { id_task } })
        if (!task) throw new Error('Tarea no encontrada')

        const promoter = await prisma.promoters.findUnique({ where: { id: id_promoter } })
        if (!promoter) throw new Error('Promotor no encontrado')

        return await prisma.tasks.update({
            where: { id_task },
            data: { id_promoter, id_status: 2, dt_update: new Date() },
            include: {
                store: { select: { id_store: true, name: true } },
                promoter: { select: { id: true, name: true, lastname: true, phone: true } },
                request: { select: { id_request: true, vc_folio: true, vc_name: true } }
            }
        })
    }

    async update(id_task: number, data: UpdateTaskDTO) {
        return await prisma.tasks.update({
            where: { id_task },
            data: {
                ...(data.id_status !== undefined && { id_status: data.id_status }),
                dt_update: new Date(),
            }
        })
    }

    async delete(id_task: number) {
        return await prisma.$transaction(async (tx) => {
            const cur = await tx.tasks.findUnique({
                where: { id_task },
                select: { id_order: true, id_request: true, id_store: true, id_status: true }
            })
            const updated = await tx.tasks.update({
                where: { id_task },
                data: { id_status: 0 }
            })
            // Visita cancelada antes de realizarse: se devuelve al saldo prepago.
            if (cur && cur.id_status > 0 && cur.id_status < 6) {
                await balanceService.refundTasks(
                    tx,
                    cur.id_order,
                    [{ id_task, id_request: cur.id_request, id_store: cur.id_store }],
                    null,
                    'Tarea cancelada antes de realizarse'
                )
            }
            return updated
        })
    }

    async acceptTask(id_task: number, id_promoter: number) {
        const task = await prisma.tasks.findUnique({
            where: { id_task },
            select: { id_promoter: true, id_status: true }
        })
        if (!task || task.id_status !== 1) throw new Error('La tarea no esta activa o no existe')
        if (task.id_promoter !== null) throw new Error('La tarea ya tiene un promotor asignado')

        // Un promotor solo puede tener una tarea EN LA QUE ESTA TRABAJANDO
        // a la vez (asignada, en camino o en ejecucion). Una tarea que ya
        // envio a revision (6) ya no depende de el, asi que no cuenta como
        // "activa" para este limite -- puede aceptar otra mientras espera
        // que el cliente la apruebe.
        const hasActiveTask = await prisma.tasks.findFirst({
            where: { id_promoter, id_status: { gte: 2, lte: 5 } },
            select: { id_task: true },
        })
        if (hasActiveTask) throw new Error('Ya tienes una tarea activa, termina la actual antes de aceptar otra')

        const rejected = await prisma.task_rejections.findUnique({
            where: { id_task_id_promoter: { id_task, id_promoter } }
        })
        if (rejected) throw new Error('El promotor ya rechazo esta tarea')

        return await prisma.tasks.update({
            where: { id_task },
            data: { id_promoter, id_status: 2 },
            include: {
                store: { select: { id_store: true, name: true } },
                request: { select: { id_request: true, vc_folio: true, vc_name: true } },
            }
        })
    }

    async rejectTask(id_task: number, id_promoter: number) {
        const task = await prisma.tasks.findUnique({
            where: { id_task },
            select: { id_promoter: true, id_status: true }
        })
        if (!task || task.id_status !== 1) throw new Error('La tarea no esta disponible')
        if (task.id_promoter !== null) throw new Error('La tarea ya fue aceptada por otro promotor')

        const existing = await prisma.task_rejections.findUnique({
            where: { id_task_id_promoter: { id_task, id_promoter } }
        })
        if (existing) return existing

        return await prisma.task_rejections.create({ data: { id_task, id_promoter, reason: 'rejected' } })
    }

    /**
     * Aprueba una tarea en revisión (id_status 6, "En revisión" en el
     * vocabulario real de la app) -> pasa a 7 ("Terminada con éxito").
     * Notifica por push al promotor para que vea su comisión aplicada sin
     * tener que reabrir la app.
     */
    async reviewApprove(id_task: number) {
        const task = await prisma.tasks.findUnique({
            where: { id_task },
            select: {
                id_status: true,
                promoter: { select: { fcm_token: true } },
                store: { select: { name: true } },
            }
        })
        if (!task) throw new Error('Tarea no encontrada')
        if (task.id_status !== 6) throw new Error('Solo se puede aprobar una tarea en revisión')

        const updated = await prisma.tasks.update({
            where: { id_task },
            data: { id_status: 7, dt_update: new Date() },
        })

        if (task.promoter?.fcm_token) {
            try {
                await NotificationService.sendPushNotification(task.promoter.fcm_token, {
                    title: '¡Tarea aprobada!',
                    body: `Tu tarea en ${task.store?.name ?? 'la tienda'} fue aprobada y tu comisión ya se aplicó.`,
                    data: { type: 'task_approved' },
                })
            } catch (error) {
                console.error(`[Task] Error al notificar aprobación de la tarea ${id_task}:`, error)
            }
        }

        return updated
    }

    /**
     * Cancela una tarea en revisión (id_status 6) a petición del cliente/admin,
     * con un comentario obligatorio -> pasa a 0 ("Cancelada"), vc_cancel_type
     * "cliente". Notifica por push al promotor asignado.
     */
    async reviewCancel(id_task: number, comment: string) {
        // El cliente rechaza una visita ya entregada: NO se cancela. Pasa a estado 10
        // ("en revision del master"); el master decide si confirma (devuelve el dinero)
        // o la mantiene aceptada (se le paga al promotor).
        const task = await prisma.tasks.findUnique({
            where: { id_task },
            select: {
                id_status: true,
                promoter: { select: { fcm_token: true } },
                store: { select: { name: true } },
            }
        })
        if (!task) throw new Error('Tarea no encontrada')
        if (task.id_status !== 6) throw new Error('Solo se puede rechazar una tarea en revisión')

        const claim = await prisma.tasks.updateMany({
            where: { id_task, id_status: 6 },
            data: {
                id_status: 10,
                vc_cancel_type: 'cliente',
                vc_cancel_reason: comment,
                dt_update: new Date(),
            },
        })
        if (claim.count !== 1) throw new Error('Solo se puede rechazar una tarea en revisión')
        const updated = await prisma.tasks.findUnique({ where: { id_task } })

        notifyTaskDisputed(id_task)
        // El promotor NO se entera del rechazo mientras el master revisa; solo se
        // le avisa cuando el master decide (confirmDispute / upholdDispute).

        return updated
    }

    /** Master: visitas que el cliente rechazo y esperan su decision (estado 10). */
    async listDisputes() {
        const tasks = await prisma.tasks.findMany({
            where: { id_status: 10 },
            orderBy: { dt_update: 'desc' },
            take: 200,
            select: {
                id_task: true,
                id_order: true,
                id_client: true,
                vc_folio: true,
                vc_cancel_reason: true,
                dt_update: true,
                store: { select: { name: true } },
                promoter: { select: { name: true, lastname: true } },
            },
        })
        const clientIds = Array.from(new Set(tasks.map(t => t.id_client)))
        const orderIds = Array.from(new Set(tasks.map(t => t.id_order)))
        const [clients, orders] = await Promise.all([
            clientIds.length ? prisma.clients.findMany({ where: { id_client: { in: clientIds } }, select: { id_client: true, name: true } }) : Promise.resolve([]),
            orderIds.length ? prisma.orders.findMany({ where: { id_order: { in: orderIds } }, select: { id_order: true, vc_folio: true } }) : Promise.resolve([]),
        ])
        const clientName = new Map<number, string | null>()
        for (const c of clients) clientName.set(c.id_client, c.name)
        const orderFolio = new Map<number, string | null>()
        for (const o of orders) orderFolio.set(o.id_order, o.vc_folio)
        return tasks.map(t => ({
            id_task: t.id_task,
            id_order: t.id_order,
            order_folio: orderFolio.get(t.id_order) ?? null,
            id_client: t.id_client,
            client_name: clientName.get(t.id_client) ?? null,
            store_name: t.store?.name ?? null,
            promoter_name: t.promoter ? `${t.promoter.name} ${t.promoter.lastname}`.trim() : null,
            reason: t.vc_cancel_reason,
            dt_rejected: t.dt_update,
        }))
    }

    /** Master confirma el rechazo del cliente: la visita queda cerrada como rechazada y se devuelve el dinero. */
    async confirmDispute(id_task: number, id_user: number, note?: string) {
        const info = await prisma.tasks.findUnique({
            where: { id_task },
            select: {
                id_status: true,
                id_order: true,
                id_request: true,
                id_store: true,
                vc_cancel_reason: true,
                promoter: { select: { fcm_token: true } },
                store: { select: { name: true } },
            },
        })
        if (!info) throw new Error('Tarea no encontrada')
        if (info.id_status !== 10) throw new Error('Esta visita ya no está en revisión del master')

        await prisma.$transaction(async (tx) => {
            const claim = await tx.tasks.updateMany({
                where: { id_task, id_status: 10 },
                data: {
                    id_status: 0,
                    vc_cancel_type: 'master',
                    vc_master_note: note?.trim() || null,
                    id_user_resolver: id_user,
                    dt_dispute_resolved: new Date(),
                    dt_update: new Date(),
                },
            })
            if (claim.count !== 1) throw new Error('Esta visita ya no está en revisión del master')
            await balanceService.refundTasks(
                tx,
                info.id_order,
                [{ id_task, id_request: info.id_request, id_store: info.id_store }],
                id_user,
                'Rechazo confirmado por el master'
            )
        })

        if (info.promoter?.fcm_token) {
            try {
                await NotificationService.sendPushNotification(info.promoter.fcm_token, {
                    title: 'Visita rechazada',
                    body: `Tu visita en ${info.store?.name ?? 'la tienda'} fue rechazada: ${info.vc_cancel_reason ?? 'sin motivo'}`,
                    data: { type: 'task_cancelled' },
                })
            } catch (error) {
                console.error(`[Task] Error al notificar rechazo confirmado de la tarea ${id_task}:`, error)
            }
        }
        notifyDisputeConfirmed(id_task)
        return await prisma.tasks.findUnique({ where: { id_task } })
    }

    /** Master NO da la razon al cliente: la visita se acepta, se le paga al promotor y el cliente la paga definitivamente. */
    async upholdDispute(id_task: number, id_user: number, note: string) {
        if (!note || !note.trim()) throw new Error('Escribe el motivo por el que se mantiene aceptada')
        const info = await prisma.tasks.findUnique({
            where: { id_task },
            select: {
                id_status: true,
                promoter: { select: { fcm_token: true } },
                store: { select: { name: true } },
            },
        })
        if (!info) throw new Error('Tarea no encontrada')
        if (info.id_status !== 10) throw new Error('Esta visita ya no está en revisión del master')

        const claim = await prisma.tasks.updateMany({
            where: { id_task, id_status: 10 },
            data: {
                id_status: 7,
                vc_master_note: note.trim(),
                id_user_resolver: id_user,
                dt_dispute_resolved: new Date(),
                dt_update: new Date(),
            },
        })
        if (claim.count !== 1) throw new Error('Esta visita ya no está en revisión del master')

        if (info.promoter?.fcm_token) {
            try {
                await NotificationService.sendPushNotification(info.promoter.fcm_token, {
                    title: '¡Tarea aprobada!',
                    body: `Tu tarea en ${info.store?.name ?? 'la tienda'} fue aprobada y tu comisión ya se aplicó.`,
                    data: { type: 'task_approved' },
                })
            } catch (error) {
                console.error(`[Task] Error al notificar aprobación de la tarea ${id_task}:`, error)
            }
        }
        notifyDisputeUpheld(id_task)
        return await prisma.tasks.findUnique({ where: { id_task } })
    }

    async findByIdOrFolio(id_task?: number, folio?: string) {
        if (id_task !== undefined) {
            return await prisma.tasks.findUnique({ where: { id_task } })
        }
        if (folio) {
            return await prisma.tasks.findUnique({ where: { vc_folio: folio } })
        }
        return null
    }

    /**
     * Fuerza el envío de la notificación de una tarea sin esperar al scheduler,
     * saltándose la deduplicación por jobId (a diferencia del disparo inmediato
     * normal) para poder repetirlo varias veces en pruebas.
     */
    async forceNotify(task: { id_task: number; id_store: number; i_current_cycle: number }) {
        await taskRankingQueue.add('rank_promoters', {
            id_task: task.id_task,
            id_store: task.id_store,
            cycle: task.i_current_cycle,
        }, {
            jobId: `rank_task_${task.id_task}_cycle_${task.i_current_cycle}_forced_${Date.now()}`,
        })
    }

    /**
     * El promotor cancela una tarea que YA habia aceptado (status 2-5, "en
     * curso"). A diferencia de rejectTask (que es rechazar una OFERTA antes
     * de aceptarla, cuando id_promoter todavia es null), aqui la tarea ya
     * tiene dueño -- por eso no basta con dejarla como esta: hay que
     * soltarla de vuelta a la bolsa (id_promoter null, status 1, ciclo de
     * ranking reiniciado) para que el sistema le busque OTRO promotor,
     * excluyendo al que la cancelo. Antes esto se hacia con un PUT generico
     * a status=8 ("Terminada con incidencia"), que la dejaba en un estado
     * muerto: parecia terminada, seguia mostrando al mismo promotor como
     * dueño, y nunca se le volvia a ofrecer a nadie.
     */
    async promoterCancelTask(id_task: number, id_promoter: number) {
        const task = await prisma.tasks.findUnique({ where: { id_task } })
        if (!task) throw new Error('Tarea no encontrada')
        if (task.id_promoter !== id_promoter) throw new Error('Esta tarea no es tuya')
        if (task.id_status < 2 || task.id_status > 5) {
            throw new Error('Solo se puede cancelar una tarea que este en curso')
        }

        const updated = await prisma.$transaction(async (tx) => {
            const updatedTask = await tx.tasks.update({
                where: { id_task },
                data: {
                    id_promoter: null,
                    id_status: 1,
                    i_current_cycle: 0,
                    dt_update: new Date(),
                },
            })
            await tx.task_rejections.upsert({
                where: { id_task_id_promoter: { id_task, id_promoter } },
                update: {},
                create: { id_task, id_promoter, reason: 'rejected' },
            })
            return updatedTask
        })

        try {
            await taskRankingQueue.add('rank_promoters', {
                id_task: updated.id_task,
                id_store: updated.id_store,
                cycle: 0,
            }, {
                jobId: `rank_task_${updated.id_task}_cycle_0_recancel_${Date.now()}`,
            })
        } catch (error) {
            console.error(`[Task] Error al re-encolar ranking tras cancelacion del promotor para la tarea ${id_task}:`, error)
        }

        return updated
    }

    async getPromoterTaskHistory(id_promoter: number, reason?: 'rejected' | 'timeout') {
        // Sin @relation en el schema hacia tasks (ver nota en schema.prisma:
        // task_rejections.id_task/id_promoter no pueden tener FK real por un
        // mismatch de tipos preexistente), así que el join se arma a mano.
        const rejections = await prisma.task_rejections.findMany({
            where: {
                id_promoter,
                ...(reason && { reason }),
            },
            orderBy: { dt_register: 'desc' },
        })

        const taskIds = [...new Set(rejections.map(r => r.id_task))]
        const tasks = await prisma.tasks.findMany({
            where: { id_task: { in: taskIds } },
            select: {
                id_task: true,
                vc_folio: true,
                store: { select: { id_store: true, name: true } },
                request: { select: { id_request: true, vc_folio: true, vc_name: true, f_value: true } },
            },
        })
        const taskMap = new Map(tasks.map(t => [t.id_task, t]))

        return rejections.map(r => ({
            ...r,
            task: taskMap.get(r.id_task) ?? null,
        }))
    }

    async getTaskChecklist(id_task: number) {
        const task = await prisma.tasks.findUnique({
            where: { id_task },
            select: {
                id_task: true, vc_folio: true, id_status: true, dt_register: true,
                id_client: true, id_order: true, id_request: true, id_promoter: true, id_store: true,
                i_notification_count: true, vc_cancel_reason: true, vc_cancel_type: true,
                client: { select: { id_client: true, name: true } },
                order: { select: { id_order: true, vc_folio: true, f_total: true, id_status: true } },
                promoter: { select: { id: true, name: true, lastname: true, phone: true, email: true } },
                store: { select: { id_store: true, name: true, store_code: true } },
                request: {
                    select: {
                        id_request: true, vc_folio: true, vc_name: true, url_rack_image: true, f_value: true,
                        // Sin filtro b_active en la query: traemos todo y filtramos abajo en JS,
                        // porque un producto/pregunta desactivado DESPUÉS de que el promotor ya
                        // respondió debe seguir viéndose en el histórico de esta tarea (si no,
                        // "desaparece" el checklist de tareas viejas contestadas). Para una tarea
                        // que aún no se contesta, sí queremos que se filtre a solo lo activo.
                        request_products: {
                            select: {
                                id_request_product: true,
                                b_active: true,
                                product: {
                                    select: { id_product: true, name: true, description: true, vc_image: true, vc_sku: true }
                                },
                                request_product_questions: {
                                    select: {
                                        id_request_product_question: true,
                                        b_active: true,
                                        question: {
                                            select: {
                                                id_question: true, question: true, question_type: true,
                                                min_value: true, max_value: true, max_photos: true,
                                                question_options: {
                                                    where: { i_status: true },
                                                    select: { id_option: true, option_text: true, option_value_numeric: true, option_order: true },
                                                    orderBy: { option_order: 'asc' as const }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        })
        if (!task) return null

        const storeAddress = await prisma.addresses.findFirst({
            where: { entity_type: 'store', entity_id: task.id_store, is_active: true },
            select: {
                street: true, ext_number: true, int_number: true,
                neighborhood: true, postal_code: true, address_references: true,
                latitude: true, longitude: true,
                city: { select: { id: true, name: true } },
                state: { select: { id: true, name: true } },
            }
        })

        let myAnswers: any[] = []
        if (task.id_promoter) {
            myAnswers = await prisma.task_answers.findMany({
                where: { id_task, id_promoter: task.id_promoter },
                select: {
                    id_task_answer: true, id_request_product_question: true,
                    vc_answer: true, vc_image_url: true, dt_register: true,
                }
            })
        }

        // Mantener un producto/pregunta si sigue activo O si ya tiene una
        // respuesta registrada (histórico), aunque se haya desactivado después.
        const answeredQuestionIds = new Set(myAnswers.map((a: any) => a.id_request_product_question))
        if (task.request) {
            task.request.request_products = task.request.request_products
                .map(rp => ({
                    ...rp,
                    request_product_questions: rp.request_product_questions.filter(
                        rpq => rpq.b_active || answeredQuestionIds.has(rpq.id_request_product_question)
                    ),
                }))
                .filter(rp => rp.b_active || rp.request_product_questions.length > 0)
        }

        const productIds = task.request?.request_products.map(rp => rp.product.id_product) ?? [];
        const answerIds = myAnswers.map((a: any) => a.id_task_answer);
        const [requestAssets, productAssets, answerAssets, arrangementAssets, arrangementAfterAssets] = await Promise.all([
            task.id_request ? resolveImages('request', [task.id_request]) : Promise.resolve(new Map<number, string>()),
            resolveImages('product', productIds),
            resolveImages('task_answer', answerIds),
            resolveImages('task_arrangement', [id_task]),
            resolveImages('task_arrangement_after', [id_task]),
        ]);

        const resolvedRequest = task.request && task.id_request
            ? {
                ...task.request,
                url_rack_image: requestAssets.get(task.id_request) ?? task.request.url_rack_image,
                request_products: task.request.request_products.map(rp => ({
                    ...rp,
                    product: { ...rp.product, vc_image: productAssets.get(rp.product.id_product) ?? rp.product.vc_image },
                })),
            }
            : task.request;

        const resolvedAnswers = myAnswers.map((a: any) => ({
            ...a,
            vc_image_url: answerAssets.get(a.id_task_answer) ?? a.vc_image_url,
        }));

        const earningsByTask = task.id_order && task.id_request
            ? await this.attachPromoterEarnings([{ id_task, id_order: task.id_order, id_request: task.id_request, id_store: task.id_store }])
            : new Map<number, number>()

        return {
            ...task,
            request: resolvedRequest,
            storeAddress,
            myAnswers: resolvedAnswers,
            arrangement_photo_url: arrangementAssets.get(id_task) ?? null,
            arrangement_photo_after_url: arrangementAfterAssets.get(id_task) ?? null,
            promoter_earnings: earningsByTask.get(id_task) ?? null,
        }
    }

    async answerTaskQuestions(
        id_task: number,
        id_promoter: number,
        answers: AnswerItemDTO[],
        images: Map<number, { buffer: Buffer; mime: string }>,
        arrangementPhoto?: { buffer: Buffer; mime: string },
        arrangementPhotoAfter?: { buffer: Buffer; mime: string }
    ) {
        const task = await prisma.tasks.findUnique({
            where: { id_task },
            select: { id_promoter: true, id_status: true, id_store: true }
        })
        if (!task) throw new Error('Tarea no encontrada')
        if (task.id_promoter !== id_promoter) throw new Error('No tienes asignada esta tarea')

        // Para saber, de las preguntas que se estan respondiendo, cuales son
        // la pregunta de sistema "piezas en existencia" y a que producto
        // pertenecen, para poder alimentar store_product_stock (mapa de
        // inventario del cliente).
        const rpqIds = answers.map(a => a.id_request_product_question)
        const rpqInfo = await prisma.request_product_questions.findMany({
            where: { id_request_product_question: { in: rpqIds } },
            select: {
                id_request_product_question: true,
                request_product: { select: { id_product: true } },
                question: { select: { b_stock_question: true } },
            }
        })
        const rpqMap = new Map(rpqInfo.map(r => [
            r.id_request_product_question,
            { id_product: r.request_product.id_product, isStock: r.question.b_stock_question }
        ]))

        const results = await prisma.$transaction(async (tx) => {
            const rows: any[] = []

            for (const item of answers) {
                const result = await tx.task_answers.upsert({
                    where: {
                        id_task_id_promoter_id_request_product_question: {
                            id_task,
                            id_promoter,
                            id_request_product_question: item.id_request_product_question,
                        }
                    },
                    update: {
                        ...(item.vc_answer !== null && item.vc_answer !== undefined && { vc_answer: item.vc_answer }),
                    },
                    create: {
                        id_task,
                        id_promoter,
                        id_request_product_question: item.id_request_product_question,
                        vc_answer: item.vc_answer ?? null,
                        dt_register: new Date(),
                    }
                })
                rows.push(result)

                const info = rpqMap.get(item.id_request_product_question)
                if (info?.isStock && item.vc_answer !== null && item.vc_answer !== undefined) {
                    const qty = parseInt(item.vc_answer, 10)
                    if (!Number.isNaN(qty) && qty >= 0) {
                        await tx.store_product_stock.upsert({
                            where: { id_store_id_product: { id_store: task.id_store, id_product: info.id_product } },
                            update: { i_quantity: qty, id_task, id_promoter },
                            create: { id_store: task.id_store, id_product: info.id_product, i_quantity: qty, id_task, id_promoter },
                        })
                    }
                }
            }

            return rows
        })

        for (const [rpqId, file] of images) {
            const existing = results.find(r => r.id_request_product_question === rpqId)

            const answerRow = await prisma.task_answers.upsert({
                where: {
                    id_task_id_promoter_id_request_product_question: {
                        id_task,
                        id_promoter,
                        id_request_product_question: rpqId,
                    }
                },
                update: {},
                create: {
                    id_task,
                    id_promoter,
                    id_request_product_question: rpqId,
                    vc_answer: null,
                    dt_register: new Date(),
                }
            })

            const { url } = await StorageService.uploadAsset({
                entity: 'task_answer',
                entity_id: answerRow.id_task_answer,
                extraRef: rpqId,
                buffer: file.buffer,
                mime: file.mime,
            })

            const updated = await prisma.task_answers.update({
                where: { id_task_answer: answerRow.id_task_answer },
                data: { vc_image_url: url },
            })

            if (existing) {
                existing.vc_image_url = url
            } else {
                results.push(updated)
            }
        }

        let arrangement_photo_url: string | null = null
        if (arrangementPhoto) {
            const { url } = await StorageService.uploadAsset({
                entity: 'task_arrangement',
                entity_id: id_task,
                buffer: arrangementPhoto.buffer,
                mime: arrangementPhoto.mime,
            })
            arrangement_photo_url = url
        }

        // Foto de "despues": el promotor la sube una vez que dejo el
        // exhibidor tal cual la referencia del cliente. Se guarda aparte de
        // la de "antes" (misma tarea, entidad distinta) para poder mostrar
        // ambas al revisar la tarea.
        let arrangement_photo_after_url: string | null = null
        if (arrangementPhotoAfter) {
            const { url } = await StorageService.uploadAsset({
                entity: 'task_arrangement_after',
                entity_id: id_task,
                buffer: arrangementPhotoAfter.buffer,
                mime: arrangementPhotoAfter.mime,
            })
            arrangement_photo_after_url = url
        }

        return { answers: results, arrangement_photo_url, arrangement_photo_after_url }
    }

    /**
     * El promotor terminó de llenar el checklist y lo manda a revisión del
     * cliente (id_status 6 = "En revisión" en el vocabulario real de la app,
     * ver fuente de verdad en webs/promotoria-saas/.../tareas/utils.ts).
     */
    async completeTask(id_task: number, id_promoter: number) {
        const task = await prisma.tasks.findUnique({
            where: { id_task },
            select: { id_promoter: true, id_status: true }
        })
        if (!task) throw new Error('Tarea no encontrada')
        if (task.id_promoter !== id_promoter) throw new Error('No tienes asignada esta tarea')

        const completed = await prisma.tasks.update({
            where: { id_task },
            data: { id_status: 6, dt_update: new Date() }
        })
        notifyTaskReadyForReview(id_task)
        return completed
    }

    async getNearbyAvailableTasks(id_promoter: number, lat: number, lng: number, radiusMeters = 1000) {
        // Un promotor solo puede tener una tarea activa a la vez (id_status 2-6:
        // asignada, en camino, llegada, iniciada, en revision). Si ya tiene una,
        // no se le ofrecen tareas nuevas.
        const hasActiveTask = await prisma.tasks.findFirst({
            where: { id_promoter, id_status: { gte: 2, lte: 6 } },
            select: { id_task: true },
        })
        if (hasActiveTask) return []

        const [tasks, rejections] = await Promise.all([
            prisma.tasks.findMany({
                where: {
                    id_status: 1,
                    id_promoter: null,
                    OR: [{ dt_next_retry: null }, { dt_next_retry: { lte: new Date() } }],
                },
                select: {
                    id_task: true, vc_folio: true, id_status: true, dt_register: true,
                    id_store: true, id_request: true,
                    store: { select: { id_store: true, name: true, store_code: true } },
                    request: { select: { id_request: true, vc_folio: true, vc_name: true, url_rack_image: true, f_value: true } },
                    order: { select: { id_order: true, vc_folio: true, f_total: true } },
                    client: { select: { id_client: true, name: true } },
                },
                orderBy: { dt_register: 'desc' },
            }),
            prisma.task_rejections.findMany({
                where: { id_promoter },
                select: { id_task: true },
            }),
        ])

        const rejectedSet = new Set(rejections.map(r => r.id_task))
        const eligible = tasks.filter(t => !rejectedSet.has(t.id_task))

        if (eligible.length === 0) return []

        const storeIds = [...new Set(eligible.map(t => t.id_store))]
        const addresses = await prisma.addresses.findMany({
            where: { entity_type: 'store', entity_id: { in: storeIds }, is_active: true },
            select: { entity_id: true, latitude: true, longitude: true, street: true, ext_number: true, neighborhood: true, postal_code: true },
        })
        const addressByStore = new Map(addresses.map(a => [a.entity_id, a]))

        const nearby = eligible.filter(t => {
            const addr = addressByStore.get(t.id_store)
            if (!addr?.latitude || !addr?.longitude) return false
            const dist = haversineMeters(lat, lng, Number(addr.latitude), Number(addr.longitude))
            return dist <= radiusMeters
        })

        if (nearby.length === 0) return []

        const requestIds = nearby.filter(t => t.id_request).map(t => t.id_request!)
        const requestAssets = await resolveImages('request', requestIds)

        return nearby.map(t => ({
            ...t,
            storeAddress: addressByStore.get(t.id_store) ?? null,
            request: t.request
                ? { ...t.request, url_rack_image: requestAssets.get(t.request.id_request) ?? t.request.url_rack_image }
                : null,
        }))
    }
}
