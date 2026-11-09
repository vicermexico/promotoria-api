import { Router } from 'express'
import { authMiddleware, requireRole, uploadMedia } from '../../core/middleware'
import { ROLES } from '../../core/constants/status.constants'
import {
    getInicio, addFondo, deleteFondo, addPersonaje, updatePersonaje, deletePersonaje,
    addCliente, updateCliente, deleteCliente, updateConfig, reordenar,
} from './inicio.controller'

const inicioRouter = Router()

// Publico: la portada la consulta cualquier visitante sin sesion.
inicioRouter.get('/', getInicio)

// Todo lo demas: solo el master (mismo patron que login-video en app-config).
const soloMaster = [authMiddleware, requireRole(ROLES.SUPER)]

inicioRouter.put('/config', ...soloMaster, updateConfig)

// Reordenar va ANTES de las rutas con /:id para que "orden" no se confunda con un id.
// (Express 5 no admite regex en los parametros: la seccion y el id se validan en el controller.)
inicioRouter.put('/:seccion/orden', ...soloMaster, reordenar)

inicioRouter.post('/fondos', ...soloMaster, uploadMedia.single('archivo'), addFondo)
inicioRouter.delete('/fondos/:id', ...soloMaster, deleteFondo)

inicioRouter.post('/personajes', ...soloMaster, uploadMedia.single('archivo'), addPersonaje)
inicioRouter.put('/personajes/:id', ...soloMaster, uploadMedia.single('archivo'), updatePersonaje)
inicioRouter.delete('/personajes/:id', ...soloMaster, deletePersonaje)

inicioRouter.post('/clientes', ...soloMaster, uploadMedia.single('archivo'), addCliente)
inicioRouter.put('/clientes/:id', ...soloMaster, uploadMedia.single('archivo'), updateCliente)
inicioRouter.delete('/clientes/:id', ...soloMaster, deleteCliente)

export default inicioRouter
