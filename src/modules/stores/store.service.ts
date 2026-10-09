import { promotoresPresentes, distM, RADIO_PRESENCIA_M } from "./presencia"
import { prisma } from '../../core/prisma'
import { CreateStoreDTO } from './store.dto'

export class Store {

    async createStore(storePaylaod: CreateStoreDTO){
        return await prisma.$transaction( async() => {
            const store =  await prisma.stores.create({
                data: {
                    id_user: storePaylaod.id_user,
                    id_channel_sale: storePaylaod.id_channel_sale,
                    name: storePaylaod.name,
                    store_code: storePaylaod.store_code,
                }
            })

            await prisma.addresses.create({
                data: {
                    entity_type: 'store',
                    entity_id: store.id_store,
                    id_country: storePaylaod.address.id_country,
                    id_state: storePaylaod.address.id_state,
                    id_city: storePaylaod.address.id_city,
                    street: storePaylaod.address.street,
                    ext_number: storePaylaod.address.ext_number,
                    int_number: storePaylaod.address.int_number,
                    neighborhood: storePaylaod.address.neighborhood,
                    postal_code: storePaylaod.address.postal_code,
                    address_references: storePaylaod.address.address_references,
                    latitude: storePaylaod.address.latitude,
                    longitude: storePaylaod.address.longitude,
                }
            })

            await prisma.store_logs.create({
                data: {
                    id_store: store.id_store,
                    id_user: storePaylaod.id_user,
                    log: `Tienda creada ${store.name}`
                }
            })
            return store
        })
    }

    async getStore(id_store: number){
        return await prisma.$transaction( async() => {
            const store = await prisma.stores.findUnique({
                where: { id_store } 
            })

            const address = await prisma.addresses.findFirstOrThrow({
                where: { entity_type: 'store', entity_id: id_store, is_active: true }
            })

            const logs = await prisma.store_logs.findMany({
                where: { id_store },
                orderBy: { dt_register: 'desc' },
                include: {
                    users: {
                        select: { name: true, lastname: true }
                    }
                }
            })


            return {...store, address, logs} 
        })
    }

    async getStores(id_client?: number) {
        return await prisma.$transaction(async () => {
            let storeIdFilter: number[] | undefined
            if (id_client !== undefined) {
                const owned = await prisma.client_stores.findMany({
                    where: { id_client },
                    select: { id_store: true },
                })
                storeIdFilter = owned.map(o => o.id_store)
            }

            const stores = await prisma.stores.findMany({
                where: {
                    i_status: 1,
                    ...(storeIdFilter ? { id_store: { in: storeIdFilter } } : {}),
                },
                include: {
                    sales_channel: {
                        select: {
                            name: true,
                            url_image: true
                        }
                    }
                }
            })

            // Promotores activos por tienda: promotores con una tarea en curso
            // (id_status 2-6: asignada, en camino, en ejecucion, en revision) en
            // esa tienda ahora mismo. Se usa para que el cliente sepa cuanta
            // cobertura ya tiene una zona antes de mandar una solicitud nueva.
            const activeTasks = await prisma.tasks.findMany({
                where: { id_status: { gte: 2, lte: 6 }, id_promoter: { not: null } },
                select: { id_store: true, id_promoter: true },
            })
            const activePromotersByStore = new Map<number, Set<number>>()
            for (const t of activeTasks) {
                if (!t.id_promoter) continue
                if (!activePromotersByStore.has(t.id_store)) activePromotersByStore.set(t.id_store, new Set())
                activePromotersByStore.get(t.id_store)!.add(t.id_promoter)
            }

            const presentes = await promotoresPresentes(prisma)
            const storesWithAddress = await Promise.all(
                stores.map(async (store) => {
                    const address = await prisma.addresses.findFirst({
                        where: { entity_type: 'store', entity_id: store.id_store, is_active: true },
                        include: {
                            country: {
                                select: {
                                    id: true,
                                    name: true,
                                }
                            },
                            state: {
                                select: {
                                    id: true,
                                    name: true,
                                }
                            },
                            city: {
                                select: {
                                    id: true,
                                    name: true,
                                }
                            }
                        }
                    })

                    const idsActivos = new Set<number>(activePromotersByStore.get(store.id_store) ?? [])
                    if (address && address.latitude != null && address.longitude != null) {
                        for (const pr of presentes) {
                            if (distM(pr.latitude, pr.longitude, Number(address.latitude), Number(address.longitude)) <= RADIO_PRESENCIA_M) idsActivos.add(pr.id)
                        }
                    }
                    const i_active_promoters = idsActivos.size

                    return { ...store, address, i_active_promoters }
                })
            )

            return storesWithAddress
        })
    }

    async updateStore(id_store: number, storePaylaod: CreateStoreDTO){
        return await prisma.$transaction(async () => {
            const store = await prisma.stores.update({
                where: { id_store },
                data: {
                    id_channel_sale: storePaylaod.id_channel_sale,
                    name: storePaylaod.name,
                    store_code: storePaylaod.store_code,
                }
            })

            const address_db = await prisma.addresses.findFirstOrThrow({
                where: { entity_type: 'store', entity_id: id_store, is_active: true },
            })

            await prisma.addresses.update({
                where: { id: address_db.id },
                data: {
                    id_country: storePaylaod.address.id_country,
                    id_state: storePaylaod.address.id_state,
                    id_city: storePaylaod.address.id_city,
                    street: storePaylaod.address.street,
                    ext_number: storePaylaod.address.ext_number,
                    int_number: storePaylaod.address.int_number,
                    neighborhood: storePaylaod.address.neighborhood,
                    postal_code: storePaylaod.address.postal_code,
                    address_references: storePaylaod.address.address_references,
                    latitude: storePaylaod.address.latitude,
                    longitude: storePaylaod.address.longitude,
                }
            })

            await prisma.store_logs.create({
                data: {
                    id_store: store.id_store,
                    id_user: storePaylaod.id_user,
                    log: `Datos de tienda actualizada ${store.name}`
                }
            })
            return store
        })
    }


    async deleteStore(id_store: number){
        return await prisma.$transaction(async () => {
            await prisma.stores.update({
                where: { id_store },
                data: {
                    i_status: 0
                }
            })

            const address = await prisma.addresses.findFirstOrThrow({
                where: { entity_type: 'store', entity_id: id_store, is_active: true }
            })

            await prisma.addresses.update({
                where: { id: address.id },
                data: {
                    is_active: false
                }
            })

            await prisma.store_logs.create({
                data: {
                    id_store,
                    id_user: 1,
                    log: `Tienda eliminada`
                }
            })
        })
    }
}