import { Router } from 'express'

import { authMiddleware } from '../../core/middleware'
import { upload } from '../../core/middleware/upload.middleware'
import { getPreorderShortfall, createPreorder, getPreorder, getPreordersByClient, updatePreorderStatus, getDeliveryTurno } from './preorder.controller'

const preorderRouter = Router()

// Todos los prepedidos de un cliente empresarial (para su panel). Va antes
// de '/tasks/:id_task' porque no comparten el mismo prefijo de todas formas,
// pero se deja explicito por el mismo cuidado de siempre con el orden de rutas.
preorderRouter.get('/clients/:id_client', authMiddleware, getPreordersByClient)

// Faltante calculado (minimo del cliente vs ultima pieza contada) para la
// tienda de esta tarea. Solo funciona si la solicitud tiene el extra
// "Prepedido" activado.
preorderRouter.get('/tasks/:id_task/shortfall', authMiddleware, getPreorderShortfall)
preorderRouter.get('/tasks/:id_task/delivery-turno', authMiddleware, getDeliveryTurno)

// Pedido acordado con el encargado/dueño de la tienda: productos+cantidades,
// su WhatsApp, dia/turno de entrega, y su firma electronica (imagen).
preorderRouter.post('/tasks/:id_task', authMiddleware, upload.single('signature'), createPreorder)
preorderRouter.get('/tasks/:id_task', authMiddleware, getPreorder)
preorderRouter.patch('/tasks/:id_task/status', authMiddleware, updatePreorderStatus)

export default preorderRouter
