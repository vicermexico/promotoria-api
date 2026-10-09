import { Request, Response } from 'express'
import { FaqService } from './faq.service'

const service = new FaqService()

export const listFaqQuestions = async (req: Request, res: Response) => {
    try {
        const data = await service.listQuestions()
        res.status(200).json({ ok: true, error: 0, data, message: 'Preguntas obtenidas exitosamente' })
    } catch (error) {
        console.error('LIST FAQ QUESTIONS ERROR:', (error as any).message)
        res.status(500).json({ ok: false, error: 1, data: null, message: 'Error al obtener las preguntas', error_backend: error })
    }
}

export const getFaqQuestion = async (req: Request, res: Response) => {
    try {
        const id_faq_question = Number(req.params.id_faq_question)
        const data = await service.getQuestion(id_faq_question)
        res.status(200).json({ ok: true, error: 0, data, message: 'Pregunta obtenida exitosamente' })
    } catch (error) {
        console.error('GET FAQ QUESTION ERROR:', (error as any).message)
        res.status(404).json({ ok: false, error: 1, data: null, message: (error as any).message || 'Pregunta no encontrada', error_backend: error })
    }
}

export const createFaqQuestion = async (req: Request, res: Response) => {
    try {
        const data = await service.createQuestion(req.body)
        res.status(200).json({ ok: true, error: 0, data, message: 'Pregunta creada exitosamente' })
    } catch (error) {
        console.error('CREATE FAQ QUESTION ERROR:', (error as any).message)
        res.status(500).json({ ok: false, error: 1, data: null, message: (error as any).message || 'Error al crear la pregunta', error_backend: error })
    }
}

export const updateFaqQuestion = async (req: Request, res: Response) => {
    try {
        const id_faq_question = Number(req.params.id_faq_question)
        const data = await service.updateQuestion(id_faq_question, req.body)
        res.status(200).json({ ok: true, error: 0, data, message: 'Pregunta actualizada exitosamente' })
    } catch (error) {
        console.error('UPDATE FAQ QUESTION ERROR:', (error as any).message)
        res.status(500).json({ ok: false, error: 1, data: null, message: (error as any).message || 'Error al actualizar la pregunta', error_backend: error })
    }
}

export const deleteFaqQuestion = async (req: Request, res: Response) => {
    try {
        const id_faq_question = Number(req.params.id_faq_question)
        const data = await service.deleteQuestion(id_faq_question)
        res.status(200).json({ ok: true, error: 0, data, message: 'Pregunta eliminada exitosamente' })
    } catch (error) {
        console.error('DELETE FAQ QUESTION ERROR:', (error as any).message)
        res.status(500).json({ ok: false, error: 1, data: null, message: (error as any).message || 'Error al eliminar la pregunta', error_backend: error })
    }
}

export const getFaqGreeting = async (req: Request, res: Response) => {
    try {
        const data = await service.getGreeting()
        res.status(200).json({ ok: true, error: 0, data: { vc_value: data }, message: 'Saludo obtenido exitosamente' })
    } catch (error) {
        console.error('GET FAQ GREETING ERROR:', (error as any).message)
        res.status(500).json({ ok: false, error: 1, data: null, message: 'Error al obtener el saludo', error_backend: error })
    }
}

export const updateFaqGreeting = async (req: Request, res: Response) => {
    try {
        const { vc_value } = req.body as { vc_value: string }
        const data = await service.setGreeting(vc_value)
        res.status(200).json({ ok: true, error: 0, data: { vc_value: data }, message: 'Saludo actualizado exitosamente' })
    } catch (error) {
        console.error('UPDATE FAQ GREETING ERROR:', (error as any).message)
        res.status(500).json({ ok: false, error: 1, data: null, message: (error as any).message || 'Error al actualizar el saludo', error_backend: error })
    }
}


export const listFaqScreens = async (req: Request, res: Response) => {
    try {
        const data = await service.listScreens()
        res.status(200).json({ ok: true, error: 0, data, message: 'Pantallas obtenidas exitosamente' })
    } catch (error) {
        console.error('LIST FAQ SCREENS ERROR:', (error as any).message)
        res.status(500).json({ ok: false, error: 1, data: null, message: 'Error al obtener las pantallas', error_backend: error })
    }
}

export const createFaqScreen = async (req: Request, res: Response) => {
    try {
        const { vc_title, vc_app_route } = req.body as { vc_title: string; vc_app_route?: string }
        if (!req.file) {
            res.status(400).json({ ok: false, error: 1, data: null, message: 'No se recibio ninguna imagen' })
            return
        }
        const data = await service.createScreen(vc_title, req.file.buffer, req.file.mimetype, req.file.originalname, vc_app_route)
        res.status(200).json({ ok: true, error: 0, data, message: 'Pantalla creada exitosamente' })
    } catch (error) {
        console.error('CREATE FAQ SCREEN ERROR:', (error as any).message)
        res.status(500).json({ ok: false, error: 1, data: null, message: (error as any).message || 'Error al crear la pantalla', error_backend: error })
    }
}

export const deleteFaqScreen = async (req: Request, res: Response) => {
    try {
        const id_faq_screen = Number(req.params.id_faq_screen)
        const data = await service.deleteScreen(id_faq_screen)
        res.status(200).json({ ok: true, error: 0, data, message: 'Pantalla eliminada exitosamente' })
    } catch (error) {
        console.error('DELETE FAQ SCREEN ERROR:', (error as any).message)
        res.status(500).json({ ok: false, error: 1, data: null, message: (error as any).message || 'Error al eliminar la pantalla', error_backend: error })
    }
}

export const addFaqScreenElement = async (req: Request, res: Response) => {
    try {
        const id_faq_screen = Number(req.params.id_faq_screen)
        const data = await service.addScreenElement(id_faq_screen, req.body)
        res.status(200).json({ ok: true, error: 0, data, message: 'Boton agregado exitosamente' })
    } catch (error) {
        console.error('ADD FAQ SCREEN ELEMENT ERROR:', (error as any).message)
        res.status(500).json({ ok: false, error: 1, data: null, message: (error as any).message || 'Error al agregar el boton', error_backend: error })
    }
}

export const deleteFaqScreenElement = async (req: Request, res: Response) => {
    try {
        const id_faq_screen_element = Number(req.params.id_faq_screen_element)
        const data = await service.deleteScreenElement(id_faq_screen_element)
        res.status(200).json({ ok: true, error: 0, data, message: 'Boton eliminado exitosamente' })
    } catch (error) {
        console.error('DELETE FAQ SCREEN ELEMENT ERROR:', (error as any).message)
        res.status(500).json({ ok: false, error: 1, data: null, message: (error as any).message || 'Error al eliminar el boton', error_backend: error })
    }
}

export const setFaqHighlightSteps = async (req: Request, res: Response) => {
    try {
        const id_faq_question = Number(req.params.id_faq_question)
        const { element_ids } = req.body as { element_ids: number[] }
        const data = await service.setHighlightSteps(id_faq_question, element_ids || [])
        res.status(200).json({ ok: true, error: 0, data, message: 'Pasos actualizados exitosamente' })
    } catch (error) {
        console.error('SET FAQ HIGHLIGHT STEPS ERROR:', (error as any).message)
        res.status(500).json({ ok: false, error: 1, data: null, message: (error as any).message || 'Error al actualizar los pasos', error_backend: error })
    }
}


export const askFaqQuestion = async (req: Request, res: Response) => {
    try {
        const { message } = req.body as { message: string }
        const data = await service.askQuestion(message || '')
        res.status(200).json({ ok: true, error: 0, data, message: 'Consulta procesada' })
    } catch (error) {
        console.error('ASK FAQ ERROR:', (error as any).message)
        res.status(500).json({ ok: false, error: 1, data: null, message: 'Error al procesar la pregunta', error_backend: error })
    }
}
