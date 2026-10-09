import { Router, Request, Response } from 'express'
import { authMiddleware, requireRole } from '../../core/middleware'
import { ROLES } from '../../core/constants/status.constants'
import { prisma } from '../../core/prisma'

const GREETING_KEY = 'faq_cliente_greeting_message'
const GREETING_DEFAULT = '¡Hola! ¿En qué te puedo ayudar con tu panel?'
const UMBRAL_MINIMO = 0.6

function norm(text: string): string {
    return (text || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

const raiz = (w: string) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w)

const bien = (res: Response, data: any, message: string) =>
    res.status(200).json({ ok: true, error: 0, data, message })
const mal = (res: Response, code: number, message: string) =>
    res.status(code).json({ ok: false, error: 1, data: null, message })

const h = (fn: (req: Request, res: Response) => Promise<any>) => async (req: Request, res: Response) => {
    try {
        await fn(req, res)
    } catch (e: any) {
        console.error('FAQ-CLIENTE ERROR:', e?.message)
        mal(res, 500, 'Error en las dudas del cliente')
    }
}

const limpiarFrases = (frases: any): string[] =>
    (Array.isArray(frases) ? frases : []).map((p: any) => String(p).trim()).filter((p: string) => p.length > 0)

const limpiarRuta = (r: any): string | null => {
    const t = String(r ?? '').trim()
    return t.startsWith('/') ? t.slice(0, 100) : null
}

const faqClienteRouter = Router()

// Saludo y "preguntar": cualquier usuario logueado (lo usara el panel del cliente).
faqClienteRouter.get('/greeting', authMiddleware, h(async (_req, res) => {
    const s = await prisma.app_settings.findUnique({ where: { vc_key: GREETING_KEY } })
    bien(res, { vc_value: s?.vc_value ?? GREETING_DEFAULT }, 'Saludo')
}))

faqClienteRouter.post('/ask', authMiddleware, h(async (req, res) => {
    const inputNorm = norm(String(req.body?.message || ''))
    const vacio = { matched: false, id_faq_cliente_question: null, vc_answer_text: null, steps: [] }
    if (!inputNorm) return bien(res, vacio, 'Consulta procesada')
    const inputWords = new Set(inputNorm.split(' ').filter((w) => w.length > 1).map(raiz))
    const questions = await prisma.faq_cliente_questions.findMany({ where: { i_status: 1 }, include: { phrases: true } })
    let mejor: { q: (typeof questions)[number]; score: number; c: number } | null = null
    for (const q of questions) {
        for (const p of q.phrases) {
            const pn = norm(p.vc_phrase)
            const words = pn.split(' ').filter((w) => w.length > 1).map(raiz)
            if (words.length === 0) continue
            let c = 0
            for (const w of words) if (inputWords.has(w)) c++
            let score = c / words.length
            if (inputNorm.includes(pn) || (inputWords.size >= 2 && pn.includes(inputNorm))) score = Math.max(score, 0.85)
            if (!mejor || score > mejor.score + 1e-9 || (Math.abs(score - mejor.score) <= 1e-9 && c > mejor.c)) mejor = { q, score, c }
        }
    }
    if (!mejor || mejor.score < UMBRAL_MINIMO) return bien(res, vacio, 'Consulta procesada')
    bien(res, {
        matched: true,
        id_faq_cliente_question: mejor.q.id_faq_cliente_question,
        vc_answer_text: mejor.q.vc_answer_text,
        vc_route: mejor.q.vc_route ?? null,
        steps: [],
    }, 'Consulta procesada')
}))

// Todo lo demas: solo el master.
const soloMaster = [authMiddleware, requireRole(ROLES.SUPER)]

faqClienteRouter.put('/greeting', ...soloMaster, h(async (req, res) => {
    const v = String(req.body?.vc_value || '').trim()
    if (!v) return mal(res, 400, 'El saludo no puede estar vacío')
    await prisma.app_settings.upsert({
        where: { vc_key: GREETING_KEY },
        create: { vc_key: GREETING_KEY, vc_value: v },
        update: { vc_value: v },
    })
    bien(res, { vc_value: v }, 'Saludo actualizado')
}))

faqClienteRouter.get('/questions', ...soloMaster, h(async (_req, res) => {
    const data = await prisma.faq_cliente_questions.findMany({
        where: { i_status: 1 }, include: { phrases: true }, orderBy: { dt_register: 'desc' },
    })
    bien(res, data, 'Preguntas')
}))

faqClienteRouter.get('/questions/:id', ...soloMaster, h(async (req, res) => {
    const data = await prisma.faq_cliente_questions.findFirst({
        where: { id_faq_cliente_question: Number(req.params.id), i_status: 1 }, include: { phrases: true },
    })
    if (!data) return mal(res, 404, 'Pregunta no encontrada')
    bien(res, data, 'Pregunta')
}))

faqClienteRouter.post('/questions', ...soloMaster, h(async (req, res) => {
    const frases = limpiarFrases(req.body?.phrases)
    const respuesta = String(req.body?.vc_answer_text || '').trim()
    if (frases.length === 0) return mal(res, 400, 'Debes agregar al menos una forma de preguntarlo')
    if (!respuesta) return mal(res, 400, 'La respuesta no puede estar vacía')
    const data = await prisma.faq_cliente_questions.create({
        data: { vc_answer_text: respuesta, vc_route: limpiarRuta(req.body?.vc_route), phrases: { create: frases.map((vc_phrase) => ({ vc_phrase })) } },
        include: { phrases: true },
    })
    bien(res, data, 'Pregunta creada')
}))

faqClienteRouter.put('/questions/:id', ...soloMaster, h(async (req, res) => {
    const id = Number(req.params.id)
    const existe = await prisma.faq_cliente_questions.findFirst({ where: { id_faq_cliente_question: id, i_status: 1 } })
    if (!existe) return mal(res, 404, 'Pregunta no encontrada')
    const respuesta = req.body?.vc_answer_text !== undefined ? String(req.body.vc_answer_text).trim() : undefined
    const frases = req.body?.phrases !== undefined ? limpiarFrases(req.body.phrases) : undefined
    if (respuesta !== undefined && !respuesta) return mal(res, 400, 'La respuesta no puede estar vacía')
    if (frases !== undefined && frases.length === 0) return mal(res, 400, 'Debes agregar al menos una forma de preguntarlo')
    const data = await prisma.$transaction(async (tx) => {
        if (respuesta !== undefined) {
            await tx.faq_cliente_questions.update({ where: { id_faq_cliente_question: id }, data: { vc_answer_text: respuesta } })
        }
        if (frases !== undefined) {
            await tx.faq_cliente_phrases.deleteMany({ where: { id_faq_cliente_question: id } })
            await tx.faq_cliente_phrases.createMany({ data: frases.map((vc_phrase) => ({ id_faq_cliente_question: id, vc_phrase })) })
        }
        if (req.body?.vc_route !== undefined) {
            await tx.faq_cliente_questions.update({ where: { id_faq_cliente_question: id }, data: { vc_route: limpiarRuta(req.body.vc_route) } })
        }
        return tx.faq_cliente_questions.findFirst({ where: { id_faq_cliente_question: id }, include: { phrases: true } })
    })
    bien(res, data, 'Pregunta actualizada')
}))

faqClienteRouter.delete('/questions/:id', ...soloMaster, h(async (req, res) => {
    const id = Number(req.params.id)
    const existe = await prisma.faq_cliente_questions.findFirst({ where: { id_faq_cliente_question: id, i_status: 1 } })
    if (!existe) return mal(res, 404, 'Pregunta no encontrada')
    await prisma.faq_cliente_questions.update({ where: { id_faq_cliente_question: id }, data: { i_status: 0 } })
    bien(res, { deleted: true }, 'Pregunta eliminada')
}))

export default faqClienteRouter
