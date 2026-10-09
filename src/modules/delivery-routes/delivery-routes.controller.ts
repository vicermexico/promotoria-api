import { Request, Response } from 'express'
import { DeliveryRoutes } from './delivery-routes.service'

const routesService = new DeliveryRoutes()

export const getPendingPreorders = async (req: Request, res: Response) => {
    try {
        const id_client = req.user!.id_client
        const date = req.query.date ? new Date(req.query.date as string) : undefined
        const time = req.query.time as 'MAÑANA' | 'TARDE' | undefined
        const preorders = await routesService.getPendingPreordersForClient(id_client, { date, time })
        res.status(200).json({ ok: true, error: 0, data: preorders, message: 'Prepedidos pendientes obtenidos exitosamente' })
    } catch (error) {
        console.error('GET PENDING PREORDERS ERROR:', error)
        res.status(500).json({ ok: false, error: 1, data: null, message: 'Error al obtener los prepedidos pendientes' })
    }
}

export const createRoute = async (req: Request, res: Response) => {
    try {
        const id_client = req.user!.id_client
        const { id_driver, route_date, stops, id_schedule, id_route_template, manana_inicio, manana_fin, tarde_inicio, tarde_fin } = req.body
        if (!id_driver || !route_date || !Array.isArray(stops) || stops.length === 0) {
            res.status(400).json({ ok: false, error: 1, data: null, message: 'id_driver, route_date y stops son requeridos' })
            return
        }
        const route = await routesService.createRoute({
            id_client,
            id_driver: Number(id_driver),
            route_date: new Date(route_date),
            id_schedule: id_schedule ? Number(id_schedule) : null,
            id_route_template: id_route_template ? Number(id_route_template) : null,
            manana_inicio: manana_inicio || null,
            manana_fin: manana_fin || null,
            tarde_inicio: tarde_inicio || null,
            tarde_fin: tarde_fin || null,
            stops,
        })
        res.status(201).json({ ok: true, error: 0, data: route, message: 'Ruta creada exitosamente' })
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Error al crear la ruta'
        res.status(400).json({ ok: false, error: 1, data: null, message })
    }
}

export const getRoutesByClient = async (req: Request, res: Response) => {
    try {
        const id_client = req.user!.id_client
        const routes = await routesService.getRoutesByClient(id_client)
        res.status(200).json({ ok: true, error: 0, data: routes, message: 'Rutas obtenidas exitosamente' })
    } catch (error) {
        res.status(500).json({ ok: false, error: 1, data: null, message: 'Error al obtener las rutas' })
    }
}

export const setRouteActive = async (req: Request, res: Response) => {
    try {
        const id_client = req.user!.id_client
        const id_route = Number(req.params.id_route)
        const { is_active } = req.body
        const route = await routesService.setRouteActive(id_route, id_client, !!is_active)
        res.status(200).json({ ok: true, error: 0, data: route, message: 'Ruta actualizada exitosamente' })
    } catch (error) {
        res.status(500).json({ ok: false, error: 1, data: null, message: (error as any).message || 'Error al actualizar la ruta' })
    }
}

export const updateRoute = async (req: Request, res: Response) => {
    try {
        const id_client = req.user!.id_client
        const id_route = Number(req.params.id_route)
        const { id_driver, route_date, stops, manana_inicio, manana_fin, tarde_inicio, tarde_fin } = req.body
        if (!id_driver || !route_date || !Array.isArray(stops)) {
            res.status(400).json({ ok: false, error: 1, data: null, message: 'Faltan datos para actualizar la ruta' })
            return
        }
        const route = await routesService.updateRoute(id_route, id_client, {
            id_driver: Number(id_driver),
            route_date: new Date(route_date),
            manana_inicio: manana_inicio || null,
            manana_fin: manana_fin || null,
            tarde_inicio: tarde_inicio || null,
            tarde_fin: tarde_fin || null,
            stops,
        })
        res.status(200).json({ ok: true, error: 0, data: route, message: 'Ruta actualizada exitosamente' })
    } catch (error) {
        res.status(500).json({ ok: false, error: 1, data: null, message: (error as any).message || 'Error al actualizar la ruta' })
    }
}

export const deleteRoute = async (req: Request, res: Response) => {
    try {
        const id_client = req.user!.id_client
        const id_route = Number(req.params.id_route)
        await routesService.deleteRoute(id_route, id_client)
        res.status(200).json({ ok: true, error: 0, data: null, message: 'Ruta eliminada exitosamente' })
    } catch (error) {
        res.status(500).json({ ok: false, error: 1, data: null, message: (error as any).message || 'Error al eliminar la ruta' })
    }
}

export const getMyRoutes = async (req: Request, res: Response) => {
    try {
        const id_driver = req.user!.id
        const routes = await routesService.getRoutesByDriver(id_driver)
        res.status(200).json({ ok: true, error: 0, data: routes, message: 'Rutas obtenidas exitosamente' })
    } catch (error) {
        res.status(500).json({ ok: false, error: 1, data: null, message: 'Error al obtener tus rutas' })
    }
}

export const updateStop = async (req: Request, res: Response) => {
    try {
        const id_driver = req.user!.id
        const id_stop = Number(req.params.id_stop)
        const updated = await routesService.updateStop(id_stop, id_driver, req.body)
        res.status(200).json({ ok: true, error: 0, data: updated, message: 'Parada actualizada exitosamente' })
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Error al actualizar la parada'
        res.status(400).json({ ok: false, error: 1, data: null, message })
    }
}

export const getStoreDeliveryHistory = async (req: Request, res: Response) => {
    try {
        const id_client = req.user!.id_client
        const id_store = Number(req.params.id_store)
        const history = await routesService.getStoreDeliveryHistory(id_store, id_client)
        res.status(200).json({ ok: true, error: 0, data: history, message: 'Historial de entregas obtenido exitosamente' })
    } catch (error) {
        res.status(500).json({ ok: false, error: 1, data: null, message: 'Error al obtener el historial de entregas' })
    }
}

export const getDriverSales = async (req: Request, res: Response) => {
    try {
        const id_client = req.user!.id_client
        const id_driver = Number(req.params.id_driver)
        const date_from = new Date(req.query.date_from as string)
        const date_to = new Date(req.query.date_to as string)
        const sales = await routesService.getDriverSales(id_driver, id_client, date_from, date_to)
        res.status(200).json({ ok: true, error: 0, data: sales, message: 'Ventas obtenidas exitosamente' })
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Error al obtener las ventas'
        res.status(400).json({ ok: false, error: 1, data: null, message })
    }
}

export const getDriverRoutesInRange = async (req: Request, res: Response) => {
    try {
        const id_client = req.user!.id_client
        const id_driver = Number(req.params.id_driver)
        const date_from = new Date(req.query.date_from as string)
        const date_to = new Date(req.query.date_to as string)
        const routes = await routesService.getDriverRoutesInRange(id_driver, id_client, date_from, date_to)
        res.status(200).json({ ok: true, error: 0, data: routes, message: 'Rutas obtenidas exitosamente' })
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Error al obtener las rutas'
        res.status(400).json({ ok: false, error: 1, data: null, message })
    }
}
