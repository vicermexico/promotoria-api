import { prisma } from '../../core/prisma'

export class RouteScheduleService {
    async create(data: { id_client: number; id_route_template: number; id_driver: number; day_of_week: number; interval_weeks: number; anchor_date: Date }) {
        return await prisma.route_driver_schedules.create({
            data: {
                id_client: data.id_client,
                id_route_template: data.id_route_template,
                id_driver: data.id_driver,
                day_of_week: data.day_of_week,
                interval_weeks: data.interval_weeks,
                anchor_date: data.anchor_date,
            },
        })
    }

    async getAllByClient(id_client: number) {
        return await prisma.route_driver_schedules.findMany({
            where: { id_client, is_active: true },
            include: {
                route_template: { select: { id_route_template: true, name: true } },
                driver: { select: { id_driver: true, name: true } },
            },
            orderBy: { dt_register: 'desc' },
        })
    }

    async delete(id_schedule: number) {
        return await prisma.route_driver_schedules.update({
            where: { id_schedule },
            data: { is_active: false },
        })
    }

    /**
     * Busca si esta tienda esta en alguna ruta con una asignacion automatica
     * activa (route_template_stores -> route_templates -> route_driver_schedules).
     * Se usa para "Fecha cerrada" de prepedidos: si la tienda tiene ruta, se
     * calcula la fecha/turno de entrega solos; si no, se deja como fecha
     * abierta (el encargado/promotor elige a mano).
     */
    async findActiveScheduleForStore(id_store: number) {
        const link = await prisma.route_template_stores.findFirst({
            where: { id_store },
            include: {
                route_template: {
                    include: {
                        schedules: { where: { is_active: true } },
                    },
                },
            },
        })
        return link?.route_template.schedules[0] ?? null
    }

    /**
     * Calcula la proxima fecha (a partir de hoy) en la que le toca entrega a
     * esta asignacion automatica, respetando el dia de la semana, el
     * intervalo de semanas y la fecha ancla. Mismo criterio de
     * dias/semana que runDailyCheck() de abajo.
     */
    computeNextDeliveryDate(schedule: { day_of_week: number; interval_weeks: number; anchor_date: Date }, from: Date = new Date()) {
        const fromDateOnly = new Date(from.getFullYear(), from.getMonth(), from.getDate())
        const jsDay = fromDateOnly.getDay()
        const fromDayOfWeek = jsDay === 0 ? 7 : jsDay

        let daysUntilTarget = schedule.day_of_week - fromDayOfWeek
        if (daysUntilTarget <= 0) daysUntilTarget += 7

        let candidate = new Date(fromDateOnly)
        candidate.setDate(candidate.getDate() + daysUntilTarget)

        const anchor = new Date(schedule.anchor_date)
        const anchorDateOnly = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate())
        const msPerWeek = 7 * 24 * 60 * 60 * 1000

        while (true) {
            const weeksSinceAnchor = Math.round((candidate.getTime() - anchorDateOnly.getTime()) / msPerWeek)
            if (weeksSinceAnchor >= 0 && weeksSinceAnchor % schedule.interval_weeks === 0) {
                return candidate
            }
            candidate = new Date(candidate)
            candidate.setDate(candidate.getDate() + 7)
        }
    }

    /**
     * Revisa todas las asignaciones automaticas activas y, para las que hoy
     * les toca (mismo dia de la semana y ya paso el numero de semanas
     * correspondiente desde su fecha ancla), crea la ruta de entrega del
     * chofer con las tiendas que tenga la plantilla EN ESE MOMENTO (si el
     * cliente le agrego/quito tiendas a la ruta despues de crear la
     * asignacion, usa la version mas reciente).
     */
    async runDailyCheck() {
        const today = new Date()
        const todayDateOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate())
        // 1=lunes...7=domingo (getDay() da 0=domingo...6=sabado)
        const jsDay = today.getDay()
        const todayDayOfWeek = jsDay === 0 ? 7 : jsDay

        // Cualquier ruta que venga de una asignacion automatica y sea de un
        // dia anterior a hoy se desactiva sola -- ya paso su fecha. Si el
        // cliente la reactivo a mano, se vuelve a apagar el dia siguiente,
        // a menos que ya le toque generarse de nuevo hoy mismo (ver abajo).
        await prisma.delivery_routes.updateMany({
            where: { id_schedule: { not: null }, route_date: { lt: todayDateOnly }, is_active: true },
            data: { is_active: false },
        })

        const schedules = await prisma.route_driver_schedules.findMany({
            where: { is_active: true, day_of_week: todayDayOfWeek },
            include: {
                route_template: { include: { stores: true } },
            },
        })

        let created = 0
        for (const schedule of schedules) {
            const anchor = new Date(schedule.anchor_date)
            const anchorDateOnly = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate())
            const msPerWeek = 7 * 24 * 60 * 60 * 1000
            const weeksSinceAnchor = Math.round((todayDateOnly.getTime() - anchorDateOnly.getTime()) / msPerWeek)
            if (weeksSinceAnchor < 0 || weeksSinceAnchor % schedule.interval_weeks !== 0) continue

            const storeIds = schedule.route_template.stores.map((s) => s.id_store)
            if (storeIds.length === 0) continue

            // Evita duplicar si el cliente ya organizo manualmente esta
            // ruta para este chofer hoy.
            const existing = await prisma.delivery_routes.findFirst({
                where: { id_driver: schedule.id_driver, route_date: todayDateOnly },
            })
            if (existing) continue

            await prisma.$transaction(async (tx) => {
                const route = await tx.delivery_routes.create({
                    data: { id_client: schedule.id_client, id_driver: schedule.id_driver, route_date: todayDateOnly, id_schedule: schedule.id_schedule, is_active: true },
                })
                await tx.delivery_route_stops.createMany({
                    data: storeIds.map((id_store, index) => ({
                        id_route: route.id_route,
                        id_store,
                        i_order: index + 1,
                    })),
                })
            })
            created++
        }

        return { checked: schedules.length, created }
    }
}
