import bcrypt from 'bcrypt'
import { prisma } from '../../core/prisma'
import { Store } from '../stores/store.service'
import { crearOVincularTienda } from '../stores/client-stores.routes'

export class Drivers {
    async create(input: { id_client: number; name: string; phone: string; email?: string; password: string }) {
        const password_hash = await bcrypt.hash(input.password, 10)
        return await prisma.drivers.create({
            data: {
                id_client: input.id_client,
                name: input.name,
                phone: input.phone,
                email: input.email,
                password_hash,
            },
        })
    }

    async listByClient(id_client: number) {
        const drivers = await prisma.drivers.findMany({
            where: { id_client, i_status: { in: [1, 2] } },
            select: {
                id_driver: true, name: true, phone: true, email: true, vc_photo: true,
                i_status: true, dt_location_updated: true, dt_register: true,
            },
            orderBy: { name: 'asc' },
        })

        // Cuantas rutas activas tiene cada chofer HOY, para mostrarlo al
        // elegir a quien asignarle una ruta nueva (ej. "Juan - 3 rutas
        // activas hoy").
        const today = new Date()
        const todayDateOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate())
        const counts = await prisma.delivery_routes.groupBy({
            by: ['id_driver'],
            where: { id_client, route_date: todayDateOnly, is_active: true },
            _count: { id_route: true },
        })
        const countByDriver = new Map(counts.map(c => [c.id_driver, c._count.id_route]))

        return drivers.map(d => ({ ...d, i_active_routes_today: countByDriver.get(d.id_driver) ?? 0 }))
    }

    async deactivate(id_driver: number, id_client: number) {
        const driver = await prisma.drivers.findUnique({ where: { id_driver } })
        if (!driver || driver.id_client !== id_client) throw new Error('Chofer no encontrado')
        return await prisma.drivers.update({ where: { id_driver }, data: { i_status: 0 } })
    }

    /**
     * Suspender: el chofer ya no puede iniciar sesion, pero sigue apareciendo
     * en la lista (a diferencia de eliminar) por si se le quiere reactivar.
     */
    async suspend(id_driver: number, id_client: number) {
        const driver = await prisma.drivers.findUnique({ where: { id_driver } })
        if (!driver || driver.id_client !== id_client) throw new Error('Chofer no encontrado')
        return await prisma.drivers.update({ where: { id_driver }, data: { i_status: 2 } })
    }

    async reactivate(id_driver: number, id_client: number) {
        const driver = await prisma.drivers.findUnique({ where: { id_driver } })
        if (!driver || driver.id_client !== id_client) throw new Error('Chofer no encontrado')
        return await prisma.drivers.update({ where: { id_driver }, data: { i_status: 1 } })
    }

    async update(id_driver: number, id_client: number, input: { name?: string; phone?: string; email?: string; vc_photo?: string }) {
        const driver = await prisma.drivers.findUnique({ where: { id_driver } })
        if (!driver || driver.id_client !== id_client) throw new Error('Chofer no encontrado')
        return await prisma.drivers.update({ where: { id_driver }, data: input })
    }

    async login(phone: string, password: string) {
        const driver = await prisma.drivers.findFirst({ where: { phone, i_status: 1 } })
        if (!driver) throw new Error('Teléfono o contraseña incorrectos')
        const valid = await bcrypt.compare(password, driver.password_hash)
        if (!valid) throw new Error('Teléfono o contraseña incorrectos')
        return driver
    }

    async checkPhoneExists(phone: string) {
        const driver = await prisma.drivers.findFirst({ where: { phone, i_status: { in: [1, 2] } } })
        return !!driver
    }

    /**
     * Un chofer puede dar de alta una tienda nueva de su mismo cliente,
     * directo desde su celular en campo. Las tiendas se guardan ligadas a
     * un usuario (id_user), no directo al cliente, asi que se busca
     * cualquier usuario activo de ese cliente para atribuirle el alta.
     */
    async createStore(id_driver: number, input: {
        name: string
        id_channel_sale?: number
        store_code?: string
        id_state: number
        id_city: number
        street?: string
        ext_number?: string
        postal_code?: string
        latitude?: string
        longitude?: string
    }) {
        const driver = await prisma.drivers.findUnique({ where: { id_driver } })
        if (!driver) throw new Error('Chofer no encontrado')

        const representante = await prisma.users.findFirst({
            where: { id_client: driver.id_client, i_status: 1 },
        })
        if (!representante) throw new Error('No se encontró un usuario del cliente para dar de alta la tienda')

        const mexico = await prisma.countries.findFirst({ where: { name: { contains: 'exico' } } })

        const { store, ya_existia } = await crearOVincularTienda(driver.id_client, {
            id_user: representante.id_user,
            id_channel_sale: input.id_channel_sale,
            name: input.name,
            store_code: input.store_code,
            address: {
                entity_type: 'store',
                entity_id: 0,
                id_country: mexico?.id ?? 1,
                id_state: input.id_state,
                id_city: input.id_city,
                street: input.street || 'Sin especificar',
                ext_number: input.ext_number || 'S/N',
                postal_code: input.postal_code || '00000',
                latitude: input.latitude,
                longitude: input.longitude,
            },
        })
        return { ...store, ya_existia }
    }

    async changePassword(id_driver: number, current_password: string, new_password: string) {
        const driver = await prisma.drivers.findUnique({ where: { id_driver } })
        if (!driver) throw new Error('Chofer no encontrado')
        const valid = await bcrypt.compare(current_password, driver.password_hash)
        if (!valid) throw new Error('La contraseña actual no es correcta')
        const password_hash = await bcrypt.hash(new_password, 10)
        return await prisma.drivers.update({ where: { id_driver }, data: { password_hash, must_change_password: false } })
    }

    /**
     * Solo el master la usa: resetea la contraseña de un chofer a "1234" y
     * marca must_change_password para que en su siguiente login se le pida
     * poner una nueva antes de dejarlo usar el resto del panel.
     */
    async resetPasswordToDefault(id_driver: number) {
        const password_hash = await bcrypt.hash('1234', 10)
        return await prisma.drivers.update({ where: { id_driver }, data: { password_hash, must_change_password: true } })
    }

    async updateLocation(id_driver: number, latitude: number, longitude: number) {
        return await prisma.drivers.update({
            where: { id_driver },
            data: { latitude, longitude, dt_location_updated: new Date() },
        })
    }

    async getById(id_driver: number) {
        return await prisma.drivers.findUnique({
            where: { id_driver },
            select: { id_driver: true, id_client: true, name: true, phone: true, email: true, vc_photo: true },
        })
    }
}
