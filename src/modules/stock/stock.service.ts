import { promotoresPresentes, mezclarPresentes } from "../stores/presencia"
import { prisma } from '../../core/prisma'

export type StockSemaphore = 'red' | 'yellow' | 'green' | null

interface SetMinimumInput {
    id_product: number
    id_store: number
    i_minimum: number
    id_user_updater?: number
}

export class Stock {

    async setMinimum(input: SetMinimumInput) {
        return await prisma.product_stock_minimums.upsert({
            where: { id_product_id_store: { id_product: input.id_product, id_store: input.id_store } },
            update: { i_minimum: input.i_minimum, id_user_updater: input.id_user_updater },
            create: {
                id_product: input.id_product,
                id_store: input.id_store,
                i_minimum: input.i_minimum,
                id_user_updater: input.id_user_updater,
            },
        })
    }

    async getMinimumsByStore(id_store: number, id_client?: number) {
        return await prisma.product_stock_minimums.findMany({
            where: {
                id_store,
                ...(id_client ? { product: { id_client } } : {}),
            },
            include: { product: { select: { id_product: true, name: true, vc_image: true } } },
        })
    }

    /**
     * Asigna el mismo minimo a varios productos, en una lista explicita de
     * tiendas (las que el cliente elija a mano de la lista, tras revisarlas
     * una por una — no todas las que cumplan un filtro a ciegas).
     */
    async bulkAssignToStores(input: {
        id_stores: number[]
        id_products: number[]
        i_minimum: number
        id_user_updater?: number
    }) {
        let assignments = 0
        await prisma.$transaction(async (tx) => {
            for (const id_store of input.id_stores) {
                for (const id_product of input.id_products) {
                    await tx.product_stock_minimums.upsert({
                        where: { id_product_id_store: { id_product, id_store } },
                        update: { i_minimum: input.i_minimum, id_user_updater: input.id_user_updater },
                        create: { id_product, id_store, i_minimum: input.i_minimum, id_user_updater: input.id_user_updater },
                    })
                    assignments++
                }
            }
        })

        return { stores_affected: input.id_stores.length, assignments }
    }

    /**
     * Asigna el mismo minimo a varios productos, en varias tiendas a la vez,
     * filtrando por cadena(s) y/o estado y/o municipios especificos (si no
     * se manda municipio, aplica a todo el estado; si no se manda estado,
     * aplica a todas las tiendas del pais que cumplan el filtro de cadena).
     * Ejemplo real: "OXXO y Seven, todo Nuevo Leon" o "OXXO, Nuevo Leon,
     * solo Guadalupe/Monterrey/Garcia".
     */
    async bulkAssignMinimum(input: {
        id_products: number[]
        i_minimum: number
        id_channels?: number[]
        id_state?: number
        id_municipios?: number[]
        id_user_updater?: number
    }) {
        const matchingStores = await prisma.stores.findMany({
            where: {
                i_status: 1,
                ...(input.id_channels && input.id_channels.length > 0
                    ? { id_channel_sale: { in: input.id_channels } }
                    : {}),
            },
            select: { id_store: true },
        })
        const storeIds = matchingStores.map(s => s.id_store)
        if (storeIds.length === 0) return { stores_affected: 0, assignments: 0 }

        const addresses = await prisma.addresses.findMany({
            where: {
                entity_type: 'store',
                entity_id: { in: storeIds },
                is_active: true,
                ...(input.id_state ? { id_state: input.id_state } : {}),
                ...(input.id_municipios && input.id_municipios.length > 0
                    ? { id_city: { in: input.id_municipios } }
                    : {}),
            },
            select: { entity_id: true },
        })
        const finalStoreIds = addresses.map(a => a.entity_id)
        if (finalStoreIds.length === 0) return { stores_affected: 0, assignments: 0 }

        let assignments = 0
        await prisma.$transaction(async (tx) => {
            for (const id_store of finalStoreIds) {
                for (const id_product of input.id_products) {
                    await tx.product_stock_minimums.upsert({
                        where: { id_product_id_store: { id_product, id_store } },
                        update: { i_minimum: input.i_minimum, id_user_updater: input.id_user_updater },
                        create: { id_product, id_store, i_minimum: input.i_minimum, id_user_updater: input.id_user_updater },
                    })
                    assignments++
                }
            }
        })

        return { stores_affected: finalStoreIds.length, assignments }
    }

    /**
     * Cuenta cuantas tiendas cumplen un filtro, para mostrar una vista
     * previa ("esto va a aplicar a 14 tiendas") antes de que el cliente
     * confirme la asignacion masiva.
     */
    async countMatchingStores(input: { id_channels?: number[]; id_state?: number; id_municipios?: number[] }) {
        const matchingStores = await prisma.stores.findMany({
            where: {
                i_status: 1,
                ...(input.id_channels && input.id_channels.length > 0
                    ? { id_channel_sale: { in: input.id_channels } }
                    : {}),
            },
            select: { id_store: true },
        })
        const storeIds = matchingStores.map(s => s.id_store)
        if (storeIds.length === 0) return 0

        const count = await prisma.addresses.count({
            where: {
                entity_type: 'store',
                entity_id: { in: storeIds },
                is_active: true,
                ...(input.id_state ? { id_state: input.id_state } : {}),
                ...(input.id_municipios && input.id_municipios.length > 0
                    ? { id_city: { in: input.id_municipios } }
                    : {}),
            },
        })
        return count
    }

    /**
     * Lista (no solo cuenta) de tiendas que cumplen el filtro, cada una con
     * cuantos de los productos seleccionados ya tienen minimo configurado
     * ahi. Para que el cliente sepa, al volver a entrar, cuales tiendas ya
     * toco y cuales le faltan.
     */
    async getMatchingStores(input: {
        id_channels?: number[]
        id_state?: number
        id_municipios?: number[]
        id_products?: number[]
    }) {
        const matchingStores = await prisma.stores.findMany({
            where: {
                i_status: 1,
                ...(input.id_channels && input.id_channels.length > 0
                    ? { id_channel_sale: { in: input.id_channels } }
                    : {}),
            },
            select: { id_store: true, name: true, sales_channel: { select: { name: true } } },
        })
        const storeIds = matchingStores.map(s => s.id_store)
        if (storeIds.length === 0) return []

        const addresses = await prisma.addresses.findMany({
            where: {
                entity_type: 'store',
                entity_id: { in: storeIds },
                is_active: true,
                ...(input.id_state ? { id_state: input.id_state } : {}),
                ...(input.id_municipios && input.id_municipios.length > 0
                    ? { id_city: { in: input.id_municipios } }
                    : {}),
            },
            include: { city: { select: { name: true } } },
        })
        const addressByStore = new Map(addresses.map(a => [a.entity_id, a]))
        const finalStoreIds = addresses.map(a => a.entity_id)
        if (finalStoreIds.length === 0) return []

        const existingMinimums = input.id_products && input.id_products.length > 0
            ? await prisma.product_stock_minimums.findMany({
                where: { id_store: { in: finalStoreIds }, id_product: { in: input.id_products } },
                select: { id_store: true, id_product: true },
            })
            : []
        const minimumsByStore = new Map<number, Set<number>>()
        for (const m of existingMinimums) {
            if (!minimumsByStore.has(m.id_store)) minimumsByStore.set(m.id_store, new Set())
            minimumsByStore.get(m.id_store)!.add(m.id_product)
        }

        const totalProducts = input.id_products?.length ?? 0

        return matchingStores
            .filter(s => finalStoreIds.includes(s.id_store))
            .map(s => {
                const address = addressByStore.get(s.id_store)
                const withMinimum = minimumsByStore.get(s.id_store)?.size ?? 0
                return {
                    id_store: s.id_store,
                    name: s.name,
                    channel_name: s.sales_channel?.name ?? null,
                    municipio_name: address?.city?.name ?? null,
                    products_with_minimum: withMinimum,
                    products_total: totalProducts,
                }
            })
    }

    /**
     * Semaforo por producto en una tienda: rojo si esta por debajo del
     * minimo, amarillo si esta a 20% o menos de distancia del minimo (le
     * falta poco para llegar), verde si esta bien surtida. Si no hay lectura
     * o no hay minimo configurado, no se puede calcular (null).
     */
    private semaphoreFor(quantity: number | null, minimum: number | null): StockSemaphore {
        if (quantity === null || minimum === null || minimum <= 0) return null
        if (quantity < minimum) return 'red'
        if (quantity <= minimum * 1.2) return 'yellow'
        return 'green'
    }

    /**
     * Datos para el mapa del cliente: tiendas (con su ubicacion, canal/logo,
     * y semaforo de inventario resultado del peor caso entre sus productos
     * con minimo configurado) y promotores actualmente activos (con tarea en
     * curso) en esas tiendas. Filtrable por canal/estado/municipio.
     */
    async getMapData(filters: { id_channel?: number; id_state?: number; id_municipio?: number; id_client?: number }) {
        const stores = await prisma.stores.findMany({
            where: {
                i_status: 1,
                ...(filters.id_channel ? { id_channel_sale: filters.id_channel } : {}),
            },
            include: {
                sales_channel: { select: { id: true, name: true, url_image: true } },
                stock_minimums: {
                    include: { product: { select: { id_product: true, name: true, id_client: true } } },
                },
            },
        })

        const storeIds = stores.map(s => s.id_store)
        const [addresses, readings, activeTasks] = await Promise.all([
            prisma.addresses.findMany({
                where: { entity_type: 'store', entity_id: { in: storeIds }, is_active: true },
                include: { state: { select: { id: true, name: true } }, city: { select: { id: true, name: true } } },
            }),
            prisma.store_product_stock.findMany({
                where: { id_store: { in: storeIds } },
            }),
            prisma.tasks.findMany({
                where: { id_status: { gte: 2, lte: 6 }, id_store: { in: storeIds }, id_promoter: { not: null } },
                select: {
                    id_store: true,
                    promoter: { select: { id: true, name: true, lastname: true, latitude: true, longitude: true } },
                },
            }),
        ])

        const presentes = await promotoresPresentes(prisma)
        const addressByStore = new Map(addresses.map(a => [a.entity_id, a]))
        const readingsByStore = new Map<number, typeof readings>()
        for (const r of readings) {
            if (!readingsByStore.has(r.id_store)) readingsByStore.set(r.id_store, [])
            readingsByStore.get(r.id_store)!.push(r)
        }
        const activePromotersByStore = new Map<number, typeof activeTasks>()
        for (const t of activeTasks) {
            if (!t.promoter) continue
            if (!activePromotersByStore.has(t.id_store)) activePromotersByStore.set(t.id_store, [])
            activePromotersByStore.get(t.id_store)!.push(t)
        }

        const result = stores
            .map(store => {
                const address = addressByStore.get(store.id_store)
                if (!address || address.latitude === null || address.longitude === null) return null
                if (filters.id_state && address.id_state !== filters.id_state) return null
                if (filters.id_municipio && address.id_city !== filters.id_municipio) return null

                const minimums = filters.id_client
                    ? store.stock_minimums.filter(m => m.product.id_client === filters.id_client)
                    : store.stock_minimums
                const storeReadings = readingsByStore.get(store.id_store) ?? []
                const readingByProduct = new Map(storeReadings.map(r => [r.id_product, r.i_quantity]))

                const products = minimums.map(m => {
                    const quantity = readingByProduct.get(m.id_product) ?? null
                    return {
                        id_product: m.id_product,
                        name: m.product.name,
                        quantity,
                        minimum: m.i_minimum,
                        semaphore: this.semaphoreFor(quantity, m.i_minimum),
                    }
                })

                // El semaforo de la tienda es el peor caso entre sus productos.
                const severity: Record<Exclude<StockSemaphore, null>, number> = { red: 0, yellow: 1, green: 2 }
                const worst = products.reduce<StockSemaphore>((acc, p) => {
                    if (!p.semaphore) return acc
                    if (!acc) return p.semaphore
                    return severity[p.semaphore] < severity[acc] ? p.semaphore : acc
                }, null)

                const promoters = (activePromotersByStore.get(store.id_store) ?? [])
                    .filter(t => t.promoter!.latitude !== null && t.promoter!.longitude !== null)
                    .map(t => ({
                        id_promoter: t.promoter!.id,
                        name: `${t.promoter!.name}${t.promoter!.lastname ? ' ' + t.promoter!.lastname : ''}`,
                        latitude: Number(t.promoter!.latitude),
                        longitude: Number(t.promoter!.longitude),
                    }))

                return {
                    id_store: store.id_store,
                    name: store.name,
                    latitude: Number(address.latitude),
                    longitude: Number(address.longitude),
                    id_state: address.id_state,
                    state_name: address.state?.name ?? null,
                    id_municipio: address.id_city,
                    municipio_name: address.city?.name ?? null,
                    channel: store.sales_channel
                        ? { id: store.sales_channel.id, name: store.sales_channel.name, logo: store.sales_channel.url_image }
                        : null,
                    semaphore: worst,
                    products,
                    active_promoters: mezclarPresentes(promoters, presentes, address, !!filters.id_client),
                }
            })
            .filter((s): s is NonNullable<typeof s> => s !== null)

        return result
    }

    /**
     * Lecturas de existencia que el promotor conto realmente en una tienda
     * (store_product_stock), con la fecha de la ultima actualizacion. Es lo
     * que ve el chofer al entregar: solo los productos que el promotor de
     * verdad reviso en esa tienda, no todo el catalogo del cliente.
     */
    async getReadingsByStore(id_store: number) {
        return await prisma.store_product_stock.findMany({
            where: { id_store },
            include: { product: { select: { id_product: true, name: true, vc_image: true } } },
            orderBy: { dt_register: 'desc' },
        })
    }
}
