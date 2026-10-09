import { z } from 'zod';
import { prisma } from "../../core/prisma" 
import { ROLES } from "../../core/constants/status.constants"
import { Utils } from "../../core/utils"
import { Router, Request, Response } from 'express';
import { authMiddleware, requireRole, validateBody } from '../../core/middleware';

const schema = z.object({
  id_client: z.number().int().positive(),
  name: z.string().trim().min(1, 'name es requerido'),
  lastname: z.string().trim().min(1, 'lastname es requerido'),
  phone: z.string().regex(/^\d{10}$/, 'El celular debe tener 10 dígitos'),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres'),
});

export const registerSuperClientUserRoutes = (router: Router) => {
  router.post('/super/client-user', authMiddleware, requireRole(ROLES.SUPER), validateBody(schema), async (req: Request, res: Response) => {
    try {
      const { id_client, name, lastname, phone, password } = req.body;
      const cliente = await prisma.clients.findUnique({ where: { id_client }, select: { id_client: true } });
      if (!cliente) {
        return res.status(404).json({ ok: false, error: 1, data: null, message: 'Cliente no encontrado' });
      }
      const existe = await prisma.users.findUnique({ where: { email: phone }, select: { id_user: true } });
      if (existe) {
        return res.status(400).json({ ok: false, error: 1, data: null, message: 'Ese número de celular ya está registrado' });
      }
      const hashed = await Utils.hash_password(password);
      const u = await prisma.users.create({
        data: {
          email: phone,
          password: hashed,
          name,
          lastname,
          i_rol: ROLES.ADMIN,
          i_status: 1,
          id_client,
          id_user_creator: req.user!.id,
          must_change_password: true,
        },
        select: { id_user: true, email: true, name: true, lastname: true, i_status: true, id_client: true, dt_register: true },
      });
      return res.status(201).json({ ok: true, error: 0, data: u, message: 'Usuario creado exitosamente' });
    } catch (error) {
      console.error('SUPER CREATE CLIENT USER ERROR:', (error as any).message);
      return res.status(500).json({ ok: false, error: 1, data: null, message: 'Error al crear el usuario' });
    }
  });
};
