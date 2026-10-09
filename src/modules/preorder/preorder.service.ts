import { prisma } from '../../core/prisma'
import { StorageService } from '../../services/storage.service'
import { RouteScheduleService } from '../route-schedules/route-schedules.service'

interface PreorderItemInput {
    id_product: number
    quantity: number
}

export class Preorder {
    private routeScheduleService = new RouteScheduleService()

    /**
     * Confirma que la tarea pertenece a una solicitud con el extra
     * "Prepedido" activado, y regresa la tarea con lo necesario (tienda,
     * cliente) para calcular el faltante.
     */
    private async getTaskWithPreorderCheck(id_task: number) {
        const task = await prisma.tasks.findUnique({
            where: { id_task },
            include: {
                request: {
                    select: {
                        b_preorder: true,
                        preorder_date_mode: true,
                        request_products: { select: { id_product: true } },
                    }
                },
                store: { select: { id_store: true, name: true } },
            },
        })
        if (!task) throw new Error('Tarea no encontrada')
        if (!task.request?.b_preorder) {
            throw new Error('Esta tarea no tiene el extra "Prepedido" activado')
        }
        return task
    }

    /**
     * Compara, para la tienda de esta tarea, la ultima pieza contada
     * (store_product_stock, ya alimentada por la pregunta de sistema de
     * conteo de piezas) contra el minimo que el cliente configuro para esa
     * tienda/producto (product_stock_minimums). Solo considera los productos
     * que son parte de ESTA solicitud (no todos los que tengan minimo
     * configurado en la tienda, aunque sean de otras solicitudes/clientes).
     * Regresa solo los productos donde falte (quantity < minimum).
     */
    /**
     * En que ruta y turno esta metida la tienda de esta tarea, para el
     * cliente de esta tarea -- lo usa la app cuando el encargado elige
     * "fecha cerrada" al levantar el prepedido, en vez de que el mismo
     * encargado escoja manana/tarde a mano.
     */
    /**
     * Para que la app sepa, antes de levantar el pedido, si a esta tarea le
     * toca "Fecha cerrada" (fecha/turno calculados solos segun la ruta
     * asignada a la tienda) o "Fecha abierta" (se piden a mano, como antes).
     * Tambien cae en "ABIERTA" si la solicitud es CERRADA pero la tienda no
     * tiene ruta asignada.
     */
    async getDeliveryTurno(id_task: number) {
        const task = await this.getTaskWithPreorderCheck(id_task)

        if (task.request?.preorder_date_mode !== 'CERRADA') {
            return { mode: 'ABIERTA' as const }
        }

        const schedule = await this.routeScheduleService.findActiveScheduleForStore(task.id_store)
        if (!schedule) {
            return { mode: 'ABIERTA' as const }
        }

        const date = this.routeScheduleService.computeNextDeliveryDate(schedule)
        const time = schedule.turno === 'MANANA' ? 'MAÑANA' : 'TARDE'
        return { mode: 'CERRADA' as const, preferred_date: date, preferred_time: time }
    }

    async getShortfall(id_task: number) {
        const task = await this.getTaskWithPreorderCheck(id_task)

        const requestProductIds = task.request!.request_products.map(rp => rp.id_product)
        if (requestProductIds.length === 0) return { store_name: task.store.name, items: [] }

        // Se traen SIEMPRE todos los productos de la solicitud, no solo los
        // que ya tienen un minimo configurado en esa tienda -- si no hay
        // minimo, se ofrecen igual para prepedido, solo que sin poder
        // calcular un faltante exacto (se deja en 0 y el promotor decide
        // cuanto pedir a mano).
        const products = await prisma.products.findMany({
            where: { id_product: { in: requestProductIds } },
            select: { id_product: true, name: true, i_stock: true, b_allow_backorder: true, i_backorder_days: true },
        })

        const minimums = await prisma.product_stock_minimums.findMany({
            where: { id_store: task.id_store, id_product: { in: requestProductIds } },
        })
        const minimumByProduct = new Map(minimums.map(m => [m.id_product, m.i_minimum]))

        const readings = await prisma.store_product_stock.findMany({
            where: { id_store: task.id_store, id_product: { in: requestProductIds } },
        })
        const readingByProduct = new Map(readings.map(r => [r.id_product, r.i_quantity]))

        const items = products.map(product => {
            const quantity = readingByProduct.get(product.id_product) ?? 0
            const minimum = minimumByProduct.get(product.id_product) ?? 0
            const shortfall = minimum - quantity
            return {
                id_product: product.id_product,
                name: product.name,
                quantity,
                minimum,
                shortfall: Math.max(shortfall, 0),
                // Para que la app pueda avisar de una vez cuanto se
                // puede surtir de inmediato vs a cuantos dias, sin tener
                // que adivinar — mismos datos que usa createPreorder.
                available_stock: product.i_stock,
                allow_backorder: product.b_allow_backorder,
                backorder_days: product.i_backorder_days,
            }
        })

        return { store_name: task.store.name, items }
    }

    /**
     * Guarda el pedido acordado (puede diferir del faltante calculado, ya
     * que es lo que el promotor y el encargado negociaron), junto con su
     * numero de WhatsApp y firma electronica. Solo se puede levantar un
     * prepedido por tarea.
     */
    async createPreorder(input: {
        id_task: number
        manager_whatsapp: string
        preferred_date?: Date
        preferred_time?: 'MAÑANA' | 'TARDE'
        signature: { buffer: Buffer; mime: string }
        items: PreorderItemInput[]
    }) {
        const task = await this.getTaskWithPreorderCheck(input.id_task)

        const existing = await prisma.task_preorders.findUnique({ where: { id_task: input.id_task } })
        if (existing) throw new Error('Esta tarea ya tiene un prepedido levantado')

        if (!input.items || input.items.length === 0) {
            throw new Error('El pedido debe tener al menos un producto')
        }

        // "Fecha cerrada": si la tienda de esta tarea esta en una ruta con
        // asignacion automatica activa, la fecha/turno de entrega se
        // calculan solos. Si no tiene ruta asignada, se cae en fecha
        // abierta (se piden fecha/turno a mano, igual que antes).
        let finalDate: Date
        let finalTime: 'MAÑANA' | 'TARDE'

        if (task.request?.preorder_date_mode === 'CERRADA') {
            const schedule = await this.routeScheduleService.findActiveScheduleForStore(task.id_store)
            if (schedule) {
                finalDate = this.routeScheduleService.computeNextDeliveryDate(schedule)
                finalTime = schedule.turno === 'MANANA' ? 'MAÑANA' : 'TARDE'
            } else {
                if (!input.preferred_date || !input.preferred_time) {
                    throw new Error('Esta tienda no tiene ruta asignada; selecciona fecha y turno manualmente')
                }
                finalDate = input.preferred_date
                finalTime = input.preferred_time
            }
        } else {
            if (!input.preferred_date || !input.preferred_time) {
                throw new Error('Debes indicar la fecha y el turno preferidos')
            }
            finalDate = input.preferred_date
            finalTime = input.preferred_time
        }

        const { url: signatureUrl } = await StorageService.uploadAsset({
            entity: 'task_preorder_signature',
            entity_id: input.id_task,
            buffer: input.signature.buffer,
            mime: input.signature.mime,
            id_client: task.id_client,
            id_user: task.id_promoter ?? 0,
        })

        const preorder = await prisma.$transaction(async (tx) => {
            const created = await tx.task_preorders.create({
                data: {
                    id_task: input.id_task,
                    manager_whatsapp: input.manager_whatsapp,
                    manager_signature: signatureUrl,
                    preferred_date: finalDate,
                    preferred_time: finalTime,
                },
            })

            // Reparto inmediato/pendiente segun el stock configurado por el
            // cliente para cada producto. Si el producto no maneja stock
            // (i_stock null), se surte completo de inmediato, igual que
            // antes de esta funcionalidad.
            const productIds = input.items.map(i => i.id_product)
            const products = await tx.products.findMany({
                where: { id_product: { in: productIds } },
                select: { id_product: true, i_stock: true, b_allow_backorder: true, i_backorder_days: true },
            })
            const productMap = new Map(products.map(p => [p.id_product, p]))

            for (const item of input.items) {
                const product = productMap.get(item.id_product)
                let immediate = item.quantity
                let backorder = 0
                let backorderDays: number | null = null

                if (product && product.i_stock !== null) {
                    immediate = Math.min(item.quantity, product.i_stock)
                    const remaining = item.quantity - immediate
                    if (remaining > 0 && product.b_allow_backorder) {
                        backorder = remaining
                        backorderDays = product.i_backorder_days
                    }
                    // Se descuenta del stock solo lo que se surte de inmediato.
                    await tx.products.update({
                        where: { id_product: item.id_product },
                        data: { i_stock: { decrement: immediate } },
                    })
                }

                await tx.task_preorder_items.create({
                    data: {
                        id_preorder: created.id_preorder,
                        id_product: item.id_product,
                        i_quantity: item.quantity,
                        i_quantity_immediate: immediate,
                        i_quantity_backorder: backorder > 0 ? backorder : null,
                        i_backorder_days: backorder > 0 ? backorderDays : null,
                    },
                })
            }

            return created
        })

        return await this.getPreorder(input.id_task) ?? preorder
    }

    async getPreorder(id_task: number) {
        return await prisma.task_preorders.findUnique({
            where: { id_task },
            include: { items: { include: { product: { select: { id_product: true, name: true } } } } },
        })
    }

    /**
     * Todos los prepedidos de un cliente empresarial (a traves de sus
     * tareas), para que los vea en su panel — que tienda, que dia y turno
     * quiere recibirlo, y que se va a surtir.
     */
    async getPreordersByClient(id_client: number) {
        const preorders = await prisma.task_preorders.findMany({
            where: { task: { id_client } },
            include: {
                items: { include: { product: { select: { id_product: true, name: true } } } },
                task: {
                    select: {
                        id_task: true,
                        vc_folio: true,
                        store: { select: { id_store: true, name: true } },
                        promoter: { select: { id: true, name: true, lastname: true } },
                    },
                },
            },
            orderBy: { preferred_date: 'asc' },
        })

        // El estado/municipio de la tienda vive en la tabla generica de
        // direcciones (entity_type='store'), no directo en el modelo store.
        const storeIds = [...new Set(preorders.map(p => p.task.store.id_store))]
        const addresses = storeIds.length
            ? await prisma.addresses.findMany({
                where: { entity_type: 'store', entity_id: { in: storeIds }, is_active: true },
                select: {
                    entity_id: true,
                    city: { select: { name: true } },
                    state: { select: { name: true } },
                },
            })
            : []
        const addressByStore = new Map(addresses.map(a => [a.entity_id, a]))

        return preorders.map(p => ({
            ...p,
            task: {
                ...p.task,
                store: {
                    ...p.task.store,
                    city: addressByStore.get(p.task.store.id_store)?.city?.name ?? null,
                    state: addressByStore.get(p.task.store.id_store)?.state?.name ?? null,
                },
            },
        }))
    }

    /**
     * Marca un prepedido como surtido (ya se le entrego la mercancia a la
     * tienda) o de vuelta a sin surtir. Lo usa el cliente empresarial desde
     * su panel de "Mis Prepedidos".
     */
    async updatePreorderStatus(id_task: number, id_status: number) {
        const preorder = await prisma.task_preorders.findUnique({ where: { id_task } })
        if (!preorder) throw new Error('Prepedido no encontrado')
        return await prisma.task_preorders.update({
            where: { id_task },
            data: { id_status },
        })
    }
}
