import { prisma } from '../../core/prisma'
import { StorageService } from '../../services/storage.service'
import { FAQ_GREETING_SETTING_KEY, FAQ_GREETING_DEFAULT, CreateFaqQuestionDTO, UpdateFaqQuestionDTO, CreateFaqScreenElementDTO } from './faq.dto'

function slugifyFaq(text: string): string {
    return text
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase()
        .slice(0, 40)
}

function normalizeFaqText(text: string): string {
    return text
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

function raizFaq(w: string): string {
    return w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w
}

const FAQ_STOP = new Set(
    'que es mi mis de la el los las como donde para un una en con por se lo al del y o a me te tu tus si ya hay ver veo puedo quiero tengo hago hacer cuando cual cuales cuanto cuantos esta este sobre sirve significa hace son he ha le les mas muy'
        .split(' ')
        .map(raizFaq),
)

function pesoFaq(w: string): number {
    return FAQ_STOP.has(w) ? 0.25 : 1
}

function palabrasFaq(norm: string): string[] {
    return norm.split(' ').filter((w) => w.length > 1).map(raizFaq)
}

export class FaqService {
    async listQuestions() {
        return prisma.faq_questions.findMany({
            where: { i_status: 1 },
            include: { phrases: true, steps: { include: { element: true }, orderBy: { i_order: 'asc' } } },
            orderBy: { dt_register: 'desc' },
        })
    }

    async getQuestion(id_faq_question: number) {
        const question = await prisma.faq_questions.findFirst({
            where: { id_faq_question, i_status: 1 },
            include: { phrases: true, steps: { include: { element: true }, orderBy: { i_order: 'asc' } } },
        })
        if (!question) throw new Error('Pregunta no encontrada')
        return question
    }

    async createQuestion(data: CreateFaqQuestionDTO) {
        const phrases = (data.phrases || []).map(p => p.trim()).filter(p => p.length > 0)
        if (phrases.length === 0) throw new Error('Debes agregar al menos una forma de preguntarlo')
        if (!data.vc_answer_text || !data.vc_answer_text.trim()) throw new Error('La respuesta no puede estar vacía')

        return prisma.faq_questions.create({
            data: {
                vc_answer_text: data.vc_answer_text.trim(),
                phrases: { create: phrases.map(vc_phrase => ({ vc_phrase })) },
            },
            include: { phrases: true, steps: { include: { element: true }, orderBy: { i_order: 'asc' } } },
        })
    }

    async updateQuestion(id_faq_question: number, data: UpdateFaqQuestionDTO) {
        const existing = await prisma.faq_questions.findFirst({ where: { id_faq_question, i_status: 1 } })
        if (!existing) throw new Error('Pregunta no encontrada')

        return prisma.$transaction(async (tx) => {
            if (data.vc_answer_text !== undefined) {
                if (!data.vc_answer_text.trim()) throw new Error('La respuesta no puede estar vacía')
                await tx.faq_questions.update({
                    where: { id_faq_question },
                    data: { vc_answer_text: data.vc_answer_text.trim() },
                })
            }

            if (data.phrases !== undefined) {
                const phrases = data.phrases.map(p => p.trim()).filter(p => p.length > 0)
                if (phrases.length === 0) throw new Error('Debes dejar al menos una forma de preguntarlo')
                await tx.faq_question_phrases.deleteMany({ where: { id_faq_question } })
                await tx.faq_question_phrases.createMany({
                    data: phrases.map(vc_phrase => ({ id_faq_question, vc_phrase })),
                })
            }

            return tx.faq_questions.findFirst({
                where: { id_faq_question },
                include: { phrases: true, steps: { include: { element: true }, orderBy: { i_order: 'asc' } } },
            })
        })
    }

    async deleteQuestion(id_faq_question: number) {
        const existing = await prisma.faq_questions.findFirst({ where: { id_faq_question, i_status: 1 } })
        if (!existing) throw new Error('Pregunta no encontrada')
        await prisma.faq_questions.update({ where: { id_faq_question }, data: { i_status: 0 } })
        return { deleted: true }
    }

    async getGreeting(): Promise<string> {
        const setting = await prisma.app_settings.findUnique({ where: { vc_key: FAQ_GREETING_SETTING_KEY } })
        return setting?.vc_value ?? FAQ_GREETING_DEFAULT
    }

    async setGreeting(vc_value: string): Promise<string> {
        const trimmed = (vc_value || '').trim()
        if (!trimmed) throw new Error('El saludo no puede estar vacío')
        await prisma.app_settings.upsert({
            where: { vc_key: FAQ_GREETING_SETTING_KEY },
            create: { vc_key: FAQ_GREETING_SETTING_KEY, vc_value: trimmed },
            update: { vc_value: trimmed },
        })
        return trimmed
    }

    async listScreens() {
        return prisma.faq_screens.findMany({
            include: { elements: true },
            orderBy: { dt_register: 'asc' },
        })
    }

    async createScreen(vc_title: string, buffer: Buffer, mime: string, originalName: string, vc_app_route?: string | null) {
        if (!vc_title || !vc_title.trim()) throw new Error('El titulo de la pantalla es requerido')

        const ext = (originalName.split('.').pop() || 'png').toLowerCase()
        const rand = Math.random().toString(36).slice(2, 8)
        const vc_screen_key = `${slugifyFaq(vc_title)}_${Date.now().toString(36)}`
        const objectPath = `faq_screens/${Date.now()}-${rand}.${ext}`

        const { url, path } = await StorageService.uploadRawFile(buffer, mime, objectPath)

        return prisma.faq_screens.create({
            data: {
                vc_screen_key,
                vc_title: vc_title.trim(),
                vc_screenshot_url: url,
                vc_screenshot_bucket_path: path,
                vc_app_route: vc_app_route || null,
            },
            include: { elements: true },
        })
    }

    async deleteScreen(id_faq_screen: number) {
        const screen = await prisma.faq_screens.findUnique({ where: { id_faq_screen } })
        if (!screen) throw new Error('Pantalla no encontrada')

        await prisma.$transaction(async (tx) => {
            const elementos = await tx.faq_screen_elements.findMany({ where: { id_faq_screen } })
            const idsElementos = elementos.map((e) => e.id_faq_screen_element)
            if (idsElementos.length > 0) {
                await tx.faq_highlight_steps.deleteMany({ where: { id_faq_screen_element: { in: idsElementos } } })
                await tx.faq_screen_elements.deleteMany({ where: { id_faq_screen } })
            }
            await tx.faq_screens.delete({ where: { id_faq_screen } })
        })

        await StorageService.deleteRawFile(screen.vc_screenshot_bucket_path)
        return { deleted: true }
    }

    async addScreenElement(id_faq_screen: number, data: CreateFaqScreenElementDTO) {
        const screen = await prisma.faq_screens.findUnique({ where: { id_faq_screen } })
        if (!screen) throw new Error('Pantalla no encontrada')

        const etiqueta = (data.vc_label && data.vc_label.trim()) || `Boton ${Date.now().toString(36)}`
        const vc_element_key = `${slugifyFaq(etiqueta)}_${Date.now().toString(36)}`

        return prisma.faq_screen_elements.create({
            data: {
                id_faq_screen,
                vc_element_key,
                vc_label: etiqueta,
                f_x: data.f_x,
                f_y: data.f_y,
                f_width: data.f_width,
                f_height: data.f_height,
                vc_direction: data.vc_direction || null,
                f_rotation_deg: data.f_rotation_deg ?? 0,
            },
        })
    }

    async deleteScreenElement(id_faq_screen_element: number) {
        const existing = await prisma.faq_screen_elements.findUnique({ where: { id_faq_screen_element } })
        if (!existing) throw new Error('Boton no encontrado')
        await prisma.faq_screen_elements.delete({ where: { id_faq_screen_element } })
        return { deleted: true }
    }

    async setHighlightSteps(id_faq_question: number, element_ids: number[]) {
        const question = await prisma.faq_questions.findFirst({ where: { id_faq_question, i_status: 1 } })
        if (!question) throw new Error('Pregunta no encontrada')

        return prisma.$transaction(async (tx) => {
            await tx.faq_highlight_steps.deleteMany({ where: { id_faq_question } })
            if (element_ids.length > 0) {
                await tx.faq_highlight_steps.createMany({
                    data: element_ids.map((id_faq_screen_element, idx) => ({
                        id_faq_question,
                        id_faq_screen_element,
                        i_order: idx,
                    })),
                })
            }
            return tx.faq_questions.findFirst({
                where: { id_faq_question },
                include: { phrases: true, steps: { include: { element: true }, orderBy: { i_order: 'asc' } } },
            })
        })
    }

    async askQuestion(message: string) {
        const inputNorm = normalizeFaqText(message)
        if (!inputNorm) {
            return { matched: false, id_faq_question: null, vc_answer_text: null, steps: [] }
        }
        const inputList = palabrasFaq(inputNorm)
        const inputWords = new Set(inputList)

        const questions = await prisma.faq_questions.findMany({
            where: { i_status: 1 },
            include: {
                phrases: true,
                steps: { include: { element: { include: { screen: true } } }, orderBy: { i_order: 'asc' } },
            },
        })

        let mejor: { question: (typeof questions)[number]; score: number; mat: number } | null = null
        for (const q of questions) {
            for (const p of q.phrases) {
                const phraseNorm = normalizeFaqText(p.vc_phrase)
                const phraseWords = palabrasFaq(phraseNorm)
                if (phraseWords.length === 0) continue
                let total = 0
                let mat = 0
                for (const w of phraseWords) {
                    const peso = pesoFaq(w)
                    total += peso
                    if (inputWords.has(w)) mat += peso
                }
                let score = mat / total
                const inputPad = ` ${inputNorm} `
                const phrasePad = ` ${phraseNorm} `
                if (inputPad.includes(phrasePad)) {
                    score = Math.max(score, 0.85)
                } else if (inputList.length >= 2 && phrasePad.includes(inputPad)) {
                    score = Math.max(score, 0.85)
                }
                const s = Math.round(score * 10000) / 10000
                const m = Math.round(mat * 10000) / 10000
                if (!mejor || s > mejor.score || (s === mejor.score && m > mejor.mat)) {
                    mejor = { question: q, score: s, mat: m }
                }
            }
        }

        const UMBRAL_MINIMO = 0.6
        if (!mejor || mejor.score < UMBRAL_MINIMO) {
            return { matched: false, id_faq_question: null, vc_answer_text: null, steps: [] }
        }

        return {
            matched: true,
            id_faq_question: mejor.question.id_faq_question,
            vc_answer_text: mejor.question.vc_answer_text,
            steps: mejor.question.steps.map((s) => ({
                vc_label: s.element.vc_label,
                f_x: s.element.f_x,
                f_y: s.element.f_y,
                f_width: s.element.f_width,
                f_height: s.element.f_height,
                vc_screenshot_url: s.element.screen.vc_screenshot_url,
                vc_app_route: s.element.screen.vc_app_route,
                vc_direction: s.element.vc_direction,
                f_rotation_deg: s.element.f_rotation_deg,
            })),
        }
    }
}
