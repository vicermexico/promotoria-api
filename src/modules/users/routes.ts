import { Router } from 'express'
import { getAllUsersByClientId, createUser, createClientUser, refreshToken } from './controller'
import { authMiddleware, requireRole, validateBody } from "../../core/middleware"
import { ROLES } from "../../core/constants/status.constants"
import { createUserSchema, createClientUserSchema } from './user.schema'

const userAdminRouter = Router()

// RUTAS ESTATICAS

/**
 * @openapi
 * /users:
 *   post:
 *     tags: [Users]
 *     summary: Crear usuario administrador
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, name, lastname, password, id_client]
 *             properties:
 *               email: { type: string, format: email }
 *               name: { type: string }
 *               lastname: { type: string }
 *               password: { type: string, minLength: 6 }
 *               i_rol: { type: integer }
 *               i_status: { type: integer }
 *               id_client: { type: integer }
 *     responses:
 *       200: { description: "Usuario creado." }
 *       400: { description: "Datos inválidos." }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       500: { $ref: '#/components/responses/ServerError' }
 */
userAdminRouter.post('/', authMiddleware, requireRole(ROLES.SUPER), validateBody(createUserSchema), createUser)

/**
 * @openapi
 * /users/client-user:
 *   post:
 *     tags: [Users]
 *     summary: El administrador de un cliente da de alta un usuario de su propio negocio
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, lastname, phone, password]
 *             properties:
 *               name: { type: string }
 *               lastname: { type: string }
 *               phone: { type: string, description: "10 dígitos; es el usuario para iniciar sesión" }
 *               password: { type: string, minLength: 6 }
 *     responses:
 *       201: { description: "Usuario creado." }
 *       400: { description: "Datos inválidos o celular ya registrado." }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
userAdminRouter.post('/client-user', authMiddleware, requireRole(ROLES.ADMIN), requireClientOwner, validateBody(createClientUserSchema), createClientUser)

/**
 * @openapi
 * /users/refresh-token:
 *   get:
 *     tags: [Users]
 *     summary: Renovar el token de sesión
 *     security: []
 *     parameters:
 *       - in: header
 *         name: Authorization
 *         schema: { type: string }
 *         description: "Bearer {token} a renovar."
 *     responses:
 *       200: { description: "Nuevo token emitido." }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
userAdminRouter.get('/refresh-token', refreshToken)

// RUTAS DINAMICAS

/**
 * @openapi
 * /users/{id_client}:
 *   get:
 *     tags: [Users]
 *     summary: Listar usuarios de un cliente
 *     parameters:
 *       - in: path
 *         name: id_client
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: "Lista de usuarios." }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       500: { $ref: '#/components/responses/ServerError' }
 */
userAdminRouter.get('/:id_client', authMiddleware, requireRole(ROLES.SUPER), getAllUsersByClientId)



export default userAdminRouter

import { registerClientUserRoutes } from './client-users.routes';
registerClientUserRoutes(userAdminRouter);

import { registerClientProfileRoutes } from './client-profile.routes';
registerClientProfileRoutes(userAdminRouter);
import { requireClientOwner } from './client-owner.middleware';
import { registerSuperClientUserRoutes } from './client-users-super.routes';
registerSuperClientUserRoutes(userAdminRouter);
