import { Request, Response } from 'express'
import { IntroVideosService } from './intro-videos.service'

const service = new IntroVideosService()

export const listIntroVideos = async (req: Request, res: Response) => {
    try {
        const data = await service.listAll()
        res.status(200).json({ ok: true, error: 0, data, message: 'Videos de introducción obtenidos exitosamente' })
    } catch (error) {
        console.error('LIST INTRO VIDEOS ERROR:', (error as any).message)
        res.status(500).json({ ok: false, error: 1, data: null, message: 'Error al obtener los videos de introducción', error_backend: error })
    }
}

export const listIntroVideosForPromoter = async (req: Request, res: Response) => {
    try {
        const data = await service.listForPromoter()
        res.status(200).json({ ok: true, error: 0, data, message: 'Videos de introducción obtenidos exitosamente' })
    } catch (error) {
        console.error('LIST INTRO VIDEOS FOR PROMOTER ERROR:', (error as any).message)
        res.status(500).json({ ok: false, error: 1, data: null, message: 'Error al obtener los videos de introducción', error_backend: error })
    }
}

export const addIntroVideoClip = async (req: Request, res: Response) => {
    try {
        const checkpoint_key = String(req.params.checkpoint_key)
        if (!req.file) {
            res.status(400).json({ ok: false, error: 1, data: null, message: 'No se recibió ningún archivo de video' })
            return
        }
        const clip = await service.addClip(checkpoint_key, req.file.buffer, req.file.mimetype, req.file.originalname)
        res.status(200).json({ ok: true, error: 0, data: clip, message: 'Video subido exitosamente' })
    } catch (error) {
        console.error('ADD INTRO VIDEO CLIP ERROR:', (error as any).message)
        res.status(500).json({ ok: false, error: 1, data: null, message: (error as any).message || 'Error al subir el video', error_backend: error })
    }
}

export const deleteIntroVideoClip = async (req: Request, res: Response) => {
    try {
        const id_clip = Number(req.params.id_clip)
        const data = await service.deleteClip(id_clip)
        res.status(200).json({ ok: true, error: 0, data, message: 'Video eliminado exitosamente' })
    } catch (error) {
        console.error('DELETE INTRO VIDEO CLIP ERROR:', (error as any).message)
        res.status(500).json({ ok: false, error: 1, data: null, message: (error as any).message || 'Error al eliminar el video', error_backend: error })
    }
}

export const processIntroVideoCheckpoint = async (req: Request, res: Response) => {
    try {
        const checkpoint_key = String(req.params.checkpoint_key)
        const data = await service.processCheckpoint(checkpoint_key)
        res.status(200).json({ ok: true, error: 0, data, message: 'Videos unidos exitosamente' })
    } catch (error) {
        console.error('PROCESS INTRO VIDEO CHECKPOINT ERROR:', (error as any).message)
        res.status(500).json({ ok: false, error: 1, data: null, message: (error as any).message || 'Error al unir los videos', error_backend: error })
    }
}

export const reorderIntroVideoClips = async (req: Request, res: Response) => {
    try {
        const checkpoint_key = String(req.params.checkpoint_key)
        const { ids } = req.body as { ids: number[] }
        const data = await service.reorderClips(checkpoint_key, ids)
        res.status(200).json({ ok: true, error: 0, data, message: 'Orden actualizado exitosamente' })
    } catch (error) {
        console.error('REORDER INTRO VIDEO CLIPS ERROR:', (error as any).message)
        res.status(500).json({ ok: false, error: 1, data: null, message: (error as any).message || 'Error al reordenar', error_backend: error })
    }
}
