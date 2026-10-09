import { Router } from 'express'
import { authMiddleware, requireRole, upload } from '../../core/middleware'
import { ROLES } from '../../core/constants/status.constants'
import { listFaqQuestions, getFaqQuestion, createFaqQuestion, updateFaqQuestion, deleteFaqQuestion, getFaqGreeting, updateFaqGreeting, listFaqScreens, createFaqScreen, deleteFaqScreen, addFaqScreenElement, deleteFaqScreenElement, setFaqHighlightSteps, askFaqQuestion } from './faq.controller'

const faqRouter = Router()

// El saludo lo puede leer cualquier usuario logueado (lo usara la app del
// promotor en la pantalla de "Dudas?"); solo el master lo puede cambiar.
faqRouter.get('/greeting', authMiddleware, getFaqGreeting)
faqRouter.post('/ask', authMiddleware, askFaqQuestion)
faqRouter.put('/greeting', authMiddleware, requireRole(ROLES.SUPER), updateFaqGreeting)

// Solo el master administra las preguntas frecuentes.
faqRouter.get('/questions', authMiddleware, requireRole(ROLES.SUPER), listFaqQuestions)
faqRouter.get('/questions/:id_faq_question', authMiddleware, requireRole(ROLES.SUPER), getFaqQuestion)
faqRouter.post('/questions', authMiddleware, requireRole(ROLES.SUPER), createFaqQuestion)
faqRouter.put('/questions/:id_faq_question', authMiddleware, requireRole(ROLES.SUPER), updateFaqQuestion)
faqRouter.delete('/questions/:id_faq_question', authMiddleware, requireRole(ROLES.SUPER), deleteFaqQuestion)
faqRouter.put('/questions/:id_faq_question/steps', authMiddleware, requireRole(ROLES.SUPER), setFaqHighlightSteps)

// Pantallas (screenshots) y botones marcados para resaltar en las respuestas.
faqRouter.get('/screens', authMiddleware, requireRole(ROLES.SUPER), listFaqScreens)
faqRouter.post('/screens', authMiddleware, requireRole(ROLES.SUPER), upload.single('screenshot'), createFaqScreen)
faqRouter.delete('/screens/:id_faq_screen', authMiddleware, requireRole(ROLES.SUPER), deleteFaqScreen)
faqRouter.post('/screens/:id_faq_screen/elements', authMiddleware, requireRole(ROLES.SUPER), addFaqScreenElement)
faqRouter.delete('/screens/elements/:id_faq_screen_element', authMiddleware, requireRole(ROLES.SUPER), deleteFaqScreenElement)

export default faqRouter
