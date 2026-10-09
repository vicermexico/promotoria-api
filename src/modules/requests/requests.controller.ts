import { Request, Response } from 'express'
import { Request as RequestService } from './requests.service'
import { StorageService } from '../../services/storage.service'
import { CreateRequestDTO, UpdateRequestDTO, RequestFiltersDTO } from './requests.dtos'

const requestService = new RequestService()

function parseNumber(value: any): number | undefined {
    if (value === undefined || value === null || value === '') return undefined
    const num = Number(value)
    return isNaN(num) ? undefined : num
}

function parseBoolean(value: any): boolean | undefined {
    if (value === undefined || value === null || value === '') return undefined
    if (typeof value === 'boolean') return value
    return value === 'true' || value === '1' || value === 1
}

function parseProducts(value: any): any[] | undefined {
    if (!value) return undefined
    if (Array.isArray(value)) return value
    try {
        const parsed = JSON.parse(value)
        return Array.isArray(parsed) ? parsed : undefined
    } catch {
        return undefined
    }
}

export const createRequest = async (req: Request, res: Response) => {
    try {
        const body = req.body
        const products = parseProducts(body.products)

        const id_user = parseNumber(body.id_user)!
        const id_client = parseNumber(body.id_client)!

        if (body.preorder_date_mode && body.preorder_date_mode !== 'ABIERTA' && body.preorder_date_mode !== 'CERRADA') {
            res.status(400).json({ ok: false, error: 1, data: null, message: "preorder_date_mode debe ser 'ABIERTA' o 'CERRADA'" })
            return
        }
        const payload: CreateRequestDTO = {
            id_user,
            id_client,
            vc_name: body.vc_name,
            f_value: parseNumber(body.f_value)!,
            url_rack_image: body.url_rack_image,
            b_preorder: parseBoolean(body.b_preorder),
            preorder_date_mode: body.preorder_date_mode,
            products,
        }

        const request = await requestService.createRequest(payload)

        // Subimos la imagen una sola vez, ya con el id real (sin archivos temporales).
        if (req.file && request.id_request) {
            const { url } = await StorageService.uploadAsset({
                entity: 'request',
                entity_id: request.id_request,
                buffer: req.file.buffer,
                mime: req.file.mimetype,
                id_client,
                id_user,
            })
            await requestService.updateRequest(request.id_request, { url_rack_image: url })
            request.url_rack_image = url
        }

        res.status(200).json({
            ok: true,
            error: 0,
            data: request,
            message: 'Solicitud creada exitosamente'
        })
    } catch (error) {
        console.error('CREATE REQUEST ERROR:', (error as any).message)
        res.status(500).json({
            ok: false,
            error: 1,
            data: null,
            message: 'Error al crear la solicitud',
            error_backend: error
        })
    }
}

export const getAllRequests = async (req: Request, res: Response) => {
    try {
        const filters: RequestFiltersDTO = {
            id_client: parseNumber(req.query.id_client),
            id_user: parseNumber(req.query.id_user),
            id_status: parseNumber(req.query.id_status),
            b_active: req.query.b_active !== undefined ? req.query.b_active === 'true' : undefined,
            page: parseNumber(req.query.page),
            limit: parseNumber(req.query.limit),
        }

        const result = await requestService.getAllRequests(filters)

        res.status(200).json({
            ok: true,
            error: 0,
            data: result,
            message: 'Solicitudes obtenidas exitosamente'
        })
    } catch (error) {
        console.error('GET ALL REQUESTS ERROR:', (error as any).message)
        res.status(500).json({
            ok: false,
            error: 1,
            data: null,
            message: 'Error al obtener las solicitudes',
            error_backend: error
        })
    }
}

export const getRequestById = async (req: Request, res: Response) => {
    try {
        const { id_request } = req.params
        const request = await requestService.getRequestById(Number(id_request))

        if (!request) {
            res.status(404).json({
                ok: false,
                error: 1,
                data: null,
                message: 'Solicitud no encontrada'
            })
            return
        }

        res.status(200).json({
            ok: true,
            error: 0,
            data: request,
            message: 'Solicitud obtenida exitosamente'
        })
    } catch (error) {
        console.error('GET REQUEST BY ID ERROR:', (error as any).message)
        res.status(500).json({
            ok: false,
            error: 1,
            data: null,
            message: 'Error al obtener la solicitud',
            error_backend: error
        })
    }
}

export const updateRequest = async (req: Request, res: Response) => {
    try {
        const { id_request } = req.params
        const body = req.body
        const products = parseProducts(body.products)

        const existing = await requestService.getRequestById(Number(id_request))
        if (!existing) {
            res.status(404).json({
                ok: false,
                error: 1,
                data: null,
                message: 'Solicitud no encontrada'
            })
            return
        }

        let url_rack_image = body.url_rack_image

        if (req.file) {
            const { url } = await StorageService.uploadAsset({
                entity: 'request',
                entity_id: Number(id_request),
                buffer: req.file.buffer,
                mime: req.file.mimetype,
                id_client: existing.id_client,
                id_user: parseNumber(body.id_user) ?? existing.id_user,
            })
            url_rack_image = url
        } else if (!url_rack_image) {
            url_rack_image = existing.url_rack_image ?? undefined
        }

        if (body.preorder_date_mode && body.preorder_date_mode !== 'ABIERTA' && body.preorder_date_mode !== 'CERRADA') {
            res.status(400).json({ ok: false, error: 1, data: null, message: "preorder_date_mode debe ser 'ABIERTA' o 'CERRADA'" })
            return
        }
        const payload: UpdateRequestDTO = {
            id_user: parseNumber(body.id_user),
            id_client: parseNumber(body.id_client),
            vc_name: body.vc_name,
            f_value: parseNumber(body.f_value),
            url_rack_image,
            id_status: parseNumber(body.id_status),
            b_preorder: parseBoolean(body.b_preorder),
            preorder_date_mode: body.preorder_date_mode,
            products,
        }

        const request = await requestService.updateRequest(Number(id_request), payload)

        res.status(200).json({
            ok: true,
            error: 0,
            data: request,
            message: 'Solicitud actualizada exitosamente'
        })
    } catch (error) {
        console.error('UPDATE REQUEST ERROR:', (error as any).message)
        res.status(500).json({
            ok: false,
            error: 1,
            data: null,
            message: 'Error al actualizar la solicitud',
            error_backend: error
        })
    }
}

export const deleteRequest = async (req: Request, res: Response) => {
    try {
        const { id_request } = req.params
        const result = await requestService.deleteRequest(Number(id_request))

        res.status(200).json({
            ok: true,
            error: 0,
            data: result,
            message: 'Solicitud eliminada exitosamente'
        })
    } catch (error) {
        console.error('DELETE REQUEST ERROR:', (error as any).message)
        res.status(500).json({
            ok: false,
            error: 1,
            data: null,
            message: 'Error al eliminar la solicitud',
            error_backend: error
        })
    }
}
