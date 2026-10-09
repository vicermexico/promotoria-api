import { prisma } from '../../core/prisma'

export class DeliveryRoutes {
    /**
     * Prepedidos sin surtir de un cliente, listos para asignarse a una ruta.
     * Es lo que alimenta tanto el mapa de Logistica (marcadores) como el
     * modo lista de "Organizar ruta". Opcionalmente filtra por fecha y
     * turno exactos (ej. "lunes 26/9 por la tarde").
     */
    async getPendingPreordersForClient(id_client: number, filters?: { date?: Date; time?: 'MAÑANA' | 'TARDE' }) {
        const preorders = await prisma.task_preorders.findMany({
            where: {
                id_status: 0, // sin surtir
                ...(filters?.date ? { preferred_date: filters.date } : {}),
                ...(filters?.time ? { preferred_time: filters.time } : {}),
                task: { id_client },
                // Ya no se muestran en la lista para asignar si ya tienen
                // una parada de ruta asignada (evita duplicar la entrega).
                delivery_stops: { none: {} },
            },
            include: {
                task: { include: { store: { select: { id_store: true, name: true } } } },
                items: { include: { product: { select: { id_product: true, name: true } } } },
            },
            orderBy: { preferred_date: 'asc' },
        })

        const storeIds = [...new Set(preorders.map(p => p.task.store.id_store))]
        const addresses = await prisma.addresses.findMany({
            where: { entity_type: 'store', entity_id: { in: storeIds }, is_active: true },
            select: { entity_id: true, latitude: true, longitude: true, street: true },
        })
        const addressByStore = new Map(addresses.map(a => [a.entity_id, a]))

        return preorders.map(p => ({
            ...p,
            task: {
                ...p.task,
                store: {
                    ...p.task.store,
                    address: addressByStore.get(p.task.store.id_store) ?? null,
                },
            },
        }))
    }

    async createRoute(input: {
        id_client: number
        id_driver: number
        route_date: Date
        id_schedule?: number | null
        id_route_template?: number | null
        manana_inicio?: string | null
        manana_fin?: string | null
        tarde_inicio?: string | null
        tarde_fin?: string | null
        stops: { id_store: number; id_preorder?: number | null; turno?: 'MAÑANA' | 'TARDE' }[]
    }) {
        const driver = await prisma.drivers.findUnique({ where: { id_driver: input.id_driver } })
        if (!driver || driver.id_client !== input.id_client) throw new Error('Chofer no encontrado')
        if (input.stops.length === 0) throw new Error('La ruta debe tener al menos una parada')

        return await prisma.$transaction(async (tx) => {
            const route = await tx.delivery_routes.create({
                data: {
                    id_client: input.id_client,
                    id_driver: input.id_driver,
                    route_date: input.route_date,
                    id_schedule: input.id_schedule ?? null,
                    id_route_template: input.id_route_template ?? null,
                    manana_inicio: input.manana_inicio ?? null,
                    manana_fin: input.manana_fin ?? null,
                    tarde_inicio: input.tarde_inicio ?? null,
                    tarde_fin: input.tarde_fin ?? null,
                },
            })
            await tx.delivery_route_stops.createMany({
                data: input.stops.map((stop, index) => ({
                    id_route: route.id_route,
                    id_store: stop.id_store,
                    id_preorder: stop.id_preorder ?? null,
                    turno: stop.turno === 'TARDE' ? 'TARDE' : 'MAÑANA',
                    i_order: index + 1,
                })),
            })
            // Las paradas de la ruta pasan a ser establecimientos del cliente (sin duplicar).
            await tx.client_stores.createMany({
                data: input.stops.map((stop) => ({ id_client: input.id_client, id_store: stop.id_store })),
                skipDuplicates: true,
            })
            return route
        })
    }

    async updateRoute(id_route: number, id_client: number, input: {
        id_driver: number
        route_date: Date
        manana_inicio?: string | null
        manana_fin?: string | null
        tarde_inicio?: string | null
        tarde_fin?: string | null
        stops: { id_store: number; id_preorder?: number | null; turno?: 'MAÑANA' | 'TARDE' }[]
    }) {
        const existing = await prisma.delivery_routes.findUnique({ where: { id_route } })
        if (!existing || existing.id_client !== id_client) throw new Error('Ruta no encontrada')
        const driver = await prisma.drivers.findUnique({ where: { id_driver: input.id_driver } })
        if (!driver || driver.id_client !== id_client) throw new Error('Chofer no encontrado')
        if (input.stops.length === 0) throw new Error('La ruta debe tener al menos una parada')

        return await prisma.$transaction(async (tx) => {
            await tx.delivery_routes.update({
                where: { id_route },
                data: {
                    id_driver: input.id_driver,
                    route_date: input.route_date,
                    manana_inicio: input.manana_inicio ?? null,
                    manana_fin: input.manana_fin ?? null,
                    tarde_inicio: input.tarde_inicio ?? null,
                    tarde_fin: input.tarde_fin ?? null,
                },
            })
            await tx.delivery_route_stops.deleteMany({ where: { id_route } })
            await tx.delivery_route_stops.createMany({
                data: input.stops.map((stop, index) => ({
                    id_route,
                    id_store: stop.id_store,
                    id_preorder: stop.id_preorder ?? null,
                    turno: stop.turno === 'TARDE' ? 'TARDE' : 'MAÑANA',
                    i_order: index + 1,
                })),
            })
            await tx.client_stores.createMany({
                data: input.stops.map((stop) => ({ id_client, id_store: stop.id_store })),
                skipDuplicates: true,
            })
            return await tx.delivery_routes.findUnique({ where: { id_route } })
        })
    }

    async deleteRoute(id_route: number, id_client: number) {
        const existing = await prisma.delivery_routes.findUnique({ where: { id_route } })
        if (!existing || existing.id_client !== id_client) throw new Error('Ruta no encontrada')
        await prisma.delivery_route_stops.deleteMany({ where: { id_route } })
        await prisma.delivery_routes.delete({ where: { id_route } })
    }

    async getRoutesByClient(id_client: number) {
        const routes = await prisma.delivery_routes.findMany({
            where: { id_client },
            include: {
                driver: { select: { id_driver: true, name: true, phone: true } },
                schedule: { select: { id_schedule: true, day_of_week: true, interval_weeks: true } },
                route_template: { select: { id_route_template: true, name: true } },
                stops: {
                    include: {
                        store: { select: { id_store: true, name: true } },
                        preorder: { include: { items: { include: { product: { select: { name: true } } } } } },
                        items: { include: { product: { select: { id_product: true, name: true } } } },
                    },
                    orderBy: { i_order: 'asc' },
                },
            },
            orderBy: { route_date: 'desc' },
        })

        return routes.map(route => ({
            ...route,
            is_finished: route.stops.length > 0 && route.stops.every(s => s.i_status === 1),
        }))
    }

    async setRouteActive(id_route: number, id_client: number, is_active: boolean) {
        const route = await prisma.delivery_routes.findUnique({ where: { id_route } })
        if (!route || route.id_client !== id_client) throw new Error('Ruta no encontrada')
        return await prisma.delivery_routes.update({ where: { id_route }, data: { is_active } })
    }

    async getRoutesByDriver(id_driver: number) {
        const routes = await prisma.delivery_routes.findMany({
            where: { id_driver },
            include: {
                route_template: { select: { id_route_template: true, name: true } },
                stops: {
                    include: {
                        store: { select: { id_store: true, name: true } },
                        preorder: { include: { items: { include: { product: { select: { name: true } } } } } },
                        items: { include: { product: { select: { id_product: true, name: true } } } },
                    },
                    orderBy: { i_order: 'asc' },
                },
            },
            orderBy: { route_date: 'desc' },
        })

        const storeIds = [...new Set(routes.flatMap(r => r.stops.map(s => s.id_store)))]
        const addresses = await prisma.addresses.findMany({
            where: { entity_type: 'store', entity_id: { in: storeIds }, is_active: true },
            select: { entity_id: true, latitude: true, longitude: true, street: true },
        })
        const addressByStore = new Map(addresses.map(a => [a.entity_id, a]))

        return routes.map(route => ({
            ...route,
            // Terminada = ya se paso por todas las paradas (visitadas o
            // marcadas sin entrega), no queda ninguna pendiente.
            is_finished: route.stops.length > 0 && route.stops.every(s => s.i_status === 1),
            stops: route.stops.map(stop => ({
                ...stop,
                store: { ...stop.store, address: addressByStore.get(stop.id_store) ?? null },
            })),
        }))
    }

    async updateStop(id_stop: number, id_driver: number, input: {
        i_status?: number
        b_delivered?: boolean
        vc_no_delivery_reason?: string
        b_consigna?: boolean
        f_amount_cash?: number
        f_amount_transfer?: number
        items?: { id_product: number; quantity: number }[]
    }) {
        const stop = await prisma.delivery_route_stops.findUnique({
            where: { id_stop },
            include: { route: true },
        })
        if (!stop || stop.route.id_driver !== id_driver) throw new Error('Parada no encontrada')

        return await prisma.$transaction(async (tx) => {
            let f_total_charged: number | undefined = undefined

            if (input.items && input.items.length > 0) {
                const productIds = input.items.map(i => i.id_product)
                const products = await tx.products.findMany({
                    where: { id_product: { in: productIds } },
                    select: { id_product: true, f_store_price: true },
                })
                const priceMap = new Map(products.map(p => [p.id_product, Number(p.f_store_price ?? 0)]))

                await tx.delivery_stop_items.deleteMany({ where: { id_stop } })
                await tx.delivery_stop_items.createMany({
                    data: input.items.map(item => ({
                        id_stop,
                        id_product: item.id_product,
                        i_quantity: item.quantity,
                        f_unit_price: priceMap.get(item.id_product) ?? 0,
                    })),
                })
                f_total_charged = input.items.reduce(
                    (sum, item) => sum + item.quantity * (priceMap.get(item.id_product) ?? 0),
                    0
                )
            }

            return await tx.delivery_route_stops.update({
                where: { id_stop },
                data: {
                    i_status: input.i_status,
                    b_delivered: input.b_delivered,
                    vc_no_delivery_reason: input.vc_no_delivery_reason,
                    b_consigna: input.b_consigna,
                    f_amount_cash: input.f_amount_cash,
                    f_amount_transfer: input.f_amount_transfer,
                    f_total_charged,
                    dt_visited: input.i_status === 1 ? new Date() : undefined,
                },
            })
        })
    }

    /**
     * Historial de entregas de una tienda: cada visita ya completada, con
     * los productos que realmente se dejaron y cuanto se cobro. Es lo que
     * el cliente ve dentro del detalle de la tienda en Logistica, para ir
     * llevando la cuenta de cuanto se le ha entregado/cobrado en total.
     */
    async getStoreDeliveryHistory(id_store: number, id_client: number) {
        const stops = await prisma.delivery_route_stops.findMany({
            where: {
                id_store,
                i_status: 1,
                route: { id_client },
            },
            include: {
                items: { include: { product: { select: { id_product: true, name: true } } } },
                route: { include: { driver: { select: { name: true } } } },
            },
            orderBy: { dt_visited: 'desc' },
        })

        const totalCharged = stops.reduce((sum, s) => sum + Number(s.f_total_charged ?? 0), 0)
        const totalsByProduct = new Map<number, { name: string; quantity: number }>()
        stops.forEach(stop => {
            stop.items.forEach(item => {
                const current = totalsByProduct.get(item.id_product) ?? { name: item.product.name, quantity: 0 }
                current.quantity += item.i_quantity
                totalsByProduct.set(item.id_product, current)
            })
        })

        return {
            visits: stops,
            total_charged: totalCharged,
            totals_by_product: Array.from(totalsByProduct.values()),
        }
    }

    /**
     * Ventas de un chofer en un rango de fechas: total vendido, piezas
     * totales, y el desglose por tienda (para el boton "Ver ventas" en
     * Choferes). Solo cuenta paradas ya visitadas con mercancia entregada.
     */
    async getDriverSales(id_driver: number, id_client: number, date_from: Date, date_to: Date) {
        const driver = await prisma.drivers.findUnique({ where: { id_driver } })
        if (!driver || driver.id_client !== id_client) throw new Error('Chofer no encontrado')

        const stops = await prisma.delivery_route_stops.findMany({
            where: {
                i_status: 1,
                b_delivered: true,
                route: { id_driver, route_date: { gte: date_from, lte: date_to } },
            },
            include: {
                store: { select: { id_store: true, name: true } },
                items: { include: { product: { select: { name: true } } } },
                route: { select: { route_date: true } },
            },
            orderBy: { dt_visited: 'desc' },
        })

        const total_charged = stops.reduce((sum, s) => sum + Number(s.f_total_charged ?? 0), 0)
        const total_pieces = stops.reduce(
            (sum, s) => sum + s.items.reduce((itemSum, item) => itemSum + item.i_quantity, 0),
            0
        )

        return {
            total_charged,
            total_pieces,
            total_visits: stops.length,
            visits: stops,
        }
    }

    /**
     * Rutas de un chofer dentro de un rango de fechas, para el boton "Ruta"
     * en Choferes.
     */
    async getDriverRoutesInRange(id_driver: number, id_client: number, date_from: Date, date_to: Date) {
        const driver = await prisma.drivers.findUnique({ where: { id_driver } })
        if (!driver || driver.id_client !== id_client) throw new Error('Chofer no encontrado')

        return await prisma.delivery_routes.findMany({
            where: { id_driver, route_date: { gte: date_from, lte: date_to } },
            include: {
                stops: {
                    include: {
                        store: { select: { id_store: true, name: true } },
                        items: { include: { product: { select: { name: true } } } },
                    },
                    orderBy: { i_order: 'asc' },
                },
            },
            orderBy: { route_date: 'desc' },
        })
    }
}
