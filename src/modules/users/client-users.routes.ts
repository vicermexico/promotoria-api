import { requireClientOwner, idsAdmins } from './client-owner.middleware';
import { z } from 'zod';
import { prisma } from "../../core/prisma" 
import { Utils } from "../../core/utils"
import { ROLES } from "../../core/constants/status.constants"
import { Router, Request, Response } from 'express';
import { authMiddleware, requireRole, validateBody } from '../../core/middleware';

const ok = (res: Response, data: any, message: string, status = 200) =>
  res.status(status).json({ ok: true, error: 0, data, message });
const fail = (res: Response, status: number, message: string) =>
  res.status(status).json({ ok: false, error: 1, data: null, message });

const updateClientUserSchema = z.object({
  name: z.string().min(1, 'name es requerido'),
  lastname: z.string().min(1, 'lastname es requerido'),
  phone: z.string().regex(/^\d{10}$/, 'El celular debe tener 10 dígitos'),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres').optional(),
});

const statusClientUserSchema = z.object({
  i_status: z.union([z.literal(0), z.literal(1)]),
});

const SELECT_USER = {
  id_user: true,
  email: true,
  name: true,
  lastname: true,
  i_status: true,
  dt_register: true,
} as const;

// Busca un usuario SOLO si pertenece al negocio de quien hace la petición.
const buscarPropio = async (id_user: number, id_client: number) =>
  prisma.users.findFirst({
    where: { id_user, id_client, i_rol: ROLES.ADMIN, i_status: { in: [0, 1] }, id_user_creator: { in: await idsAdmins(id_client) } },
    select: SELECT_USER,
  });

export const registerClientUserRoutes = (router: Router) => {
  router.get('/client-user/list', authMiddleware, requireRole(ROLES.ADMIN), async (req: Request, res: Response) => {
    try {
      const id_client = Number(req.user!.id_client);
      if (!id_client) return fail(res, 400, 'No se pudo identificar tu negocio');
      const users = await prisma.users.findMany({
        where: { id_client, i_rol: ROLES.ADMIN, i_status: { in: [0, 1] }, id_user_creator: { in: await idsAdmins(id_client) } },
        select: SELECT_USER,
        orderBy: { name: 'asc' },
      });
      const data = users.map((u: any) => ({ ...u, is_me: u.id_user === req.user!.id }));
      return ok(res, data, 'Usuarios obtenidos exitosamente');
    } catch (error) {
      console.error('LIST CLIENT USERS ERROR:', (error as any).message);
      return fail(res, 500, 'Error al obtener los usuarios');
    }
  });

  router.put('/client-user/:id_user', authMiddleware, requireRole(ROLES.ADMIN), requireClientOwner, validateBody(updateClientUserSchema), async (req: Request, res: Response) => {
    try {
      const id_user = Number(req.params.id_user);
      const id_client = Number(req.user!.id_client);
      if (!id_user || !id_client) return fail(res, 400, 'Solicitud inválida');
      const target = await buscarPropio(id_user, id_client);
      if (!target) return fail(res, 404, 'Usuario no encontrado');

      const { name, lastname, phone, password } = req.body;
      if (phone !== target.email) {
        const existe = await prisma.users.findUnique({ where: { email: phone }, select: { id_user: true } });
        if (existe) return fail(res, 400, 'Ese número de celular ya está registrado');
      }
      const data: any = { name, lastname, email: phone, dt_updated: new Date() };
      if (password) {
        data.password = await Utils.hash_password(password);
        data.must_change_password = true;
      }
      const updated = await prisma.users.update({ where: { id_user }, data, select: SELECT_USER });
      return ok(res, updated, 'Usuario actualizado exitosamente');
    } catch (error) {
      console.error('UPDATE CLIENT USER ERROR:', (error as any).message);
      return fail(res, 500, 'Error al actualizar el usuario');
    }
  });

  router.patch('/client-user/:id_user/status', authMiddleware, requireRole(ROLES.ADMIN), requireClientOwner, validateBody(statusClientUserSchema), async (req: Request, res: Response) => {
    try {
      const id_user = Number(req.params.id_user);
      const id_client = Number(req.user!.id_client);
      if (!id_user || !id_client) return fail(res, 400, 'Solicitud inválida');
      if (id_user === req.user!.id) return fail(res, 400, 'No puedes suspender tu propio usuario');
      const target = await buscarPropio(id_user, id_client);
      if (!target) return fail(res, 404, 'Usuario no encontrado');
      const updated = await prisma.users.update({
        where: { id_user },
        data: { i_status: req.body.i_status, dt_updated: new Date() },
        select: SELECT_USER,
      });
      return ok(res, updated, req.body.i_status === 1 ? 'Usuario reactivado' : 'Usuario suspendido');
    } catch (error) {
      console.error('STATUS CLIENT USER ERROR:', (error as any).message);
      return fail(res, 500, 'Error al cambiar el estado del usuario');
    }
  });

  router.delete('/client-user/:id_user', authMiddleware, requireRole(ROLES.ADMIN), requireClientOwner, async (req: Request, res: Response) => {
    try {
      const id_user = Number(req.params.id_user);
      const id_client = Number(req.user!.id_client);
      if (!id_user || !id_client) return fail(res, 400, 'Solicitud inválida');
      if (id_user === req.user!.id) return fail(res, 400, 'No puedes eliminar tu propio usuario');
      const target = await buscarPropio(id_user, id_client);
      if (!target) return fail(res, 404, 'Usuario no encontrado');
      // Baja lógica: se conserva el registro (historial) y se libera el celular.
      await prisma.users.update({
        where: { id_user },
        data: {
          i_status: 2,
          email: `${target.email}#del${id_user}`.slice(0, 100),
          reset_password_token: null,
          reset_password_expires: null,
          dt_updated: new Date(),
        },
      });
      return ok(res, null, 'Usuario eliminado');
    } catch (error) {
      console.error('DELETE CLIENT USER ERROR:', (error as any).message);
      return fail(res, 500, 'Error al eliminar el usuario');
    }
  });
};
