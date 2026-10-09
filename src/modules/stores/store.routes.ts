import { Router } from 'express'

import { authMiddleware, validateBody } from '../../core/middleware'
import { createStore, getStore, getStores, updateStore, deleteStore } from './store.controller'
import { createStoreSchema, updateStoreSchema } from './store.schema'
import { registerClientStoreRoutes } from './client-stores.routes'

const storeRouter = Router()

/**
 * @openapi
 * components:
 *   schemas:
 *     StoreAddress:
 *       type: object
 *       required: [entity_type, entity_id, id_country, id_state, id_city, street, ext_number, postal_code]
 *       properties:
 *         entity_type: { type: string, example: "store" }
 *         entity_id: { type: integer }
 *         id_country: { type: integer }
 *         id_state: { type: integer }
 *         id_city: { type: integer }
 *         street: { type: string }
 *         ext_number: { type: string }
 *         int_number: { type: string }
 *         neighborhood: { type: string }
 *         postal_code: { type: string }
 *         address_references: { type: string }
 *         latitude: { type: number }
 *         longitude: { type: number }
 *
 * /stores:
 *   post:
 *     tags: [Stores]
 *     summary: Crear tienda
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id_user, name, address]
 *             properties:
 *               id_user: { type: integer }
 *               id_channel_sale: { type: integer }
 *               name: { type: string }
 *               store_code: { type: string }
 *               address: { $ref: '#/components/schemas/StoreAddress' }
 *     responses:
 *       200: { description: "Tienda creada." }
 *       400: { description: "Datos inválidos." }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *   get:
 *     tags: [Stores]
 *     summary: Listar tiendas
 *     responses:
 *       200: { description: "Lista de tiendas." }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
storeRouter.post('/', authMiddleware, validateBody(createStoreSchema), createStore);
storeRouter.get('/', authMiddleware, getStores);

/**
 * @openapi
 * /stores/{id_store}:
 *   get:
 *     tags: [Stores]
 *     summary: Obtener una tienda
 *     parameters:
 *       - in: path
 *         name: id_store
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: "Tienda encontrada." }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       500: { $ref: '#/components/responses/ServerError' }
 *   put:
 *     tags: [Stores]
 *     summary: Actualizar una tienda
 *     parameters:
 *       - in: path
 *         name: id_store
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               store_code: { type: string }
 *               id_channel_sale: { type: integer }
 *               address: { $ref: '#/components/schemas/StoreAddress' }
 *     responses:
 *       200: { description: "Tienda actualizada." }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *   delete:
 *     tags: [Stores]
 *     summary: Eliminar una tienda
 *     parameters:
 *       - in: path
 *         name: id_store
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: "Tienda eliminada." }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
storeRouter.get('/:id_store', authMiddleware, getStore);
storeRouter.put('/:id_store', authMiddleware, validateBody(updateStoreSchema), updateStore);
storeRouter.delete('/:id_store', authMiddleware, deleteStore);

registerClientStoreRoutes(storeRouter)

export default storeRouter