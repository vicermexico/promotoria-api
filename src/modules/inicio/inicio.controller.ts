import { Request, Response } from 'express'
import { Inicio, InicioError } from './inicio.service'
import { InicioArchivoDTO } from './inicio.dto'

const inicioService = new Inicio()

// Errores de validacion (InicioError) -> 400 con su mensaje; cualquier otro -> 500 generico.
const responderError = (res: Response, etiqueta: string, mensajeGenerico: string, error: unknown) => {
    if (error instanceof InicioError) {
        res.status(400).json({ ok: false, error: 1, data: null, message: error.message })
        return
    }
    console.error(`${etiqueta} ERROR:`, (error as any)?.message)
    res.status(500).json({ ok: false, error: 1, data: null, message: mensajeGenerico, error_backend: (error as any)?.message })
}

const ok = (res: Response, data: unknown, message: string) =>
    res.status(200).json({ ok: true, error: 0, data, message })

const archivoDe = (req: Request): InicioArchivoDTO | undefined =>
    req.file ? { buffer: req.file.buffer, mime: req.file.mimetype, originalName: req.file.originalname } : undefined

// Id numerico de la URL; si no lo es responde 400 y devuelve null.
const idDe = (req: Request, res: Response): number | null => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ ok: false, error: 1, data: null, message: 'Id inválido' })
        return null
    }
    return id
}

const faltaArchivo = (res: Response) =>
    res.status(400).json({ ok: false, error: 1, data: null, message: 'No se recibió ningún archivo' })

// 1) GET /inicio (publico)
export const getInicio = async (req: Request, res: Response) => {
    try {
        ok(res, await inicioService.getDatos(), 'Portada obtenida exitosamente')
    } catch (error) {
        responderError(res, 'GET INICIO', 'Error al obtener la portada', error)
    }
}

// 2) POST /inicio/fondos
export const addFondo = async (req: Request, res: Response) => {
    try {
        const archivo = archivoDe(req)
        if (!archivo) return faltaArchivo(res)
        ok(res, await inicioService.addFondo(archivo), 'Fondo agregado exitosamente')
    } catch (error) {
        responderError(res, 'ADD FONDO', 'Error al agregar el fondo', error)
    }
}

// 3) DELETE /inicio/fondos/:id
export const deleteFondo = async (req: Request, res: Response) => {
    try {
        const id = idDe(req, res)
        if (id === null) return
        ok(res, await inicioService.deleteFondo(id), 'Fondo eliminado exitosamente')
    } catch (error) {
        responderError(res, 'DELETE FONDO', 'Error al eliminar el fondo', error)
    }
}

// 4) POST /inicio/personajes
export const addPersonaje = async (req: Request, res: Response) => {
    try {
        const archivo = archivoDe(req)
        if (!archivo) return faltaArchivo(res)
        ok(res, await inicioService.addPersonaje(archivo, req.body?.nombre, req.body?.puesto), 'Personaje agregado exitosamente')
    } catch (error) {
        responderError(res, 'ADD PERSONAJE', 'Error al agregar el personaje', error)
    }
}

// 5) PUT /inicio/personajes/:id
export const updatePersonaje = async (req: Request, res: Response) => {
    try {
        const id = idDe(req, res)
        if (id === null) return
        ok(res, await inicioService.updatePersonaje(id, req.body ?? {}, archivoDe(req)), 'Personaje actualizado exitosamente')
    } catch (error) {
        responderError(res, 'UPDATE PERSONAJE', 'Error al actualizar el personaje', error)
    }
}

// 6) DELETE /inicio/personajes/:id
export const deletePersonaje = async (req: Request, res: Response) => {
    try {
        const id = idDe(req, res)
        if (id === null) return
        ok(res, await inicioService.deletePersonaje(id), 'Personaje eliminado exitosamente')
    } catch (error) {
        responderError(res, 'DELETE PERSONAJE', 'Error al eliminar el personaje', error)
    }
}

// 7) POST /inicio/clientes
export const addCliente = async (req: Request, res: Response) => {
    try {
        const archivo = archivoDe(req)
        if (!archivo) return faltaArchivo(res)
        ok(res, await inicioService.addCliente(archivo, req.body?.nombre, req.body?.enlace), 'Cliente agregado exitosamente')
    } catch (error) {
        responderError(res, 'ADD CLIENTE', 'Error al agregar el cliente', error)
    }
}

// 8) PUT /inicio/clientes/:id
export const updateCliente = async (req: Request, res: Response) => {
    try {
        const id = idDe(req, res)
        if (id === null) return
        ok(res, await inicioService.updateCliente(id, req.body ?? {}, archivoDe(req)), 'Cliente actualizado exitosamente')
    } catch (error) {
        responderError(res, 'UPDATE CLIENTE', 'Error al actualizar el cliente', error)
    }
}

// 9) DELETE /inicio/clientes/:id
export const deleteCliente = async (req: Request, res: Response) => {
    try {
        const id = idDe(req, res)
        if (id === null) return
        ok(res, await inicioService.deleteCliente(id), 'Cliente eliminado exitosamente')
    } catch (error) {
        responderError(res, 'DELETE CLIENTE', 'Error al eliminar el cliente', error)
    }
}

// 10) PUT /inicio/config
export const updateConfig = async (req: Request, res: Response) => {
    try {
        ok(res, await inicioService.updateConfig(req.body ?? {}), 'Configuración actualizada exitosamente')
    } catch (error) {
        responderError(res, 'UPDATE CONFIG INICIO', 'Error al actualizar la configuración', error)
    }
}

// 11) PUT /inicio/:seccion/orden   body: { ids: number[] }
export const reordenar = async (req: Request, res: Response) => {
    try {
        const seccion = String(req.params.seccion)
        if (!Inicio.esSeccionValida(seccion)) {
            res.status(400).json({ ok: false, error: 1, data: null, message: 'Sección inválida' })
            return
        }
        const ids = req.body?.ids
        if (!Array.isArray(ids) || !ids.every((n) => Number.isInteger(n))) {
            res.status(400).json({ ok: false, error: 1, data: null, message: 'Se requiere "ids": lista de números enteros' })
            return
        }
        ok(res, await inicioService.reordenar(seccion, ids as number[]), 'Orden actualizado exitosamente')
    } catch (error) {
        responderError(res, 'REORDENAR INICIO', 'Error al reordenar', error)
    }
}
