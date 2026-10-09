import { Request, Response } from 'express'

import { CreateStoreDTO } from './store.dto'
import { Store } from './store.service'


const storeService = new Store()


export const createStore = async (req: Request, res: Response) => {
    const body: CreateStoreDTO = req.body
    try {
        const store = await storeService.createStore(body)
        res.status(200).json({
            ok: true,
            error: 0,
            data: store,
            message: 'Tienda creada exitosamente'
        })
    } catch(error){
        console.error('CREATE STORE ERROR:', (error as any).message)
        res.status(500).json({
            ok: false,
            error: 1,
            data: null,
            message: 'Error al crear la tienda',
            error_backend: error
        })
    }
}

export const getStore = async (req: Request, res: Response) => {
    const { id_store } = req.params
    try {
        const store = quitarCreador(req, await storeService.getStore(Number(id_store)))
        res.status(200).json({
            ok: true,
            error: 0,
            data: store,
            message: 'Tienda obtenida exitosamente'
        })
    } catch (error) {
        res.status(500).json({
            ok: false,
            error: 1,
            data: null,
            message: 'Error al obtener la tienda',
            error_backend: error
        })
    }
}

// A los usuarios del panel de un cliente no se les manda id_user (quien dio de alta
// la tienda): es un dato interno. Super admin y app del promotor lo reciben igual.
const quitarCreador = (req: Request, data: any): any => {
    const u: any = (req as any).user
    const esPanelCliente = u && !u.phone && u.i_rol === 2
    if (!esPanelCliente) return data
    const limpiar = (t: any) => {
        if (!t || typeof t !== 'object') return t
        const { id_user, ...resto } = t
        return resto
    }
    return Array.isArray(data) ? data.map(limpiar) : limpiar(data)
}

export const getStores = async (req: Request, res: Response) => {
    try {
        // ?mine=1 filtra a solo las tiendas que ya son del cliente que hace
        // la peticion (las que ya aparecieron en algun pedido suyo). Sin
        // ese parametro, se sigue comportando igual que siempre: el
        // directorio completo compartido.
        const mine = req.query.mine === '1' || req.query.mine === 'true'
        const id_client = mine ? req.user?.id_client : undefined
        const stores = quitarCreador(req, await storeService.getStores(id_client))
        res.status(200).json({
            ok: true,
            error: 0,
            data: stores,
            message: 'Tiendas obtenidas exitosamente'
        })
    } catch (error){
        res.status(500).json({
            ok: false,
            error: 1,
            data: null,
            message: 'Error al obtener las tiendas',
            error_backend: error
        }) 
    }
}

export const updateStore = async (req: Request, res: Response) => {
    const { id_store } = req.params
    const body: CreateStoreDTO = req.body

    try {
        const store = await storeService.updateStore(Number(id_store), body)
        res.status(200).json({
            ok: true,
            error: 0,
            data: store,
            message: 'Tienda actualizada exitosamente'
        })
    } catch (error) {
        res.status(500).json({
            ok: false,
            error: 1,
            data: null,
            message: 'Error al actualizar la tienda',
            error_backend: error
        })
    }
}

export const deleteStore = async (req: Request, res: Response) => {
    const { id_store } = req.params
    
    try {
        const store = await storeService.deleteStore(Number(id_store))
        res.status(200).json({
            ok: true,
            error: 0,
            data: store,
            message: 'Tienda eliminada exitosamente'
        })
    } catch (error) {
        res.status(500).json({
            ok: false,
            error: 1,
            data: null,
            message: 'Error al eliminar la tienda',
            error_backend: error
        })
    }
}