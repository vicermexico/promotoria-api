import { z } from 'zod';
import { prisma } from "../../core/prisma" 
import { ROLES } from "../../core/constants/status.constants"
import { Router, Request, Response } from 'express';
import { authMiddleware, requireRole, validateBody } from '../../core/middleware';
import { esDuenoDelNegocio } from './client-owner.middleware';

const ok = (res: Response, data: any, message: string) =>
  res.status(200).json({ ok: true, error: 0, data, message });
const fail = (res: Response, status: number, message: string) =>
  res.status(status).json({ ok: false, error: 1, data: null, message });

const emailOpcional = z.string().max(255).refine(
  (v) => v === '' || z.string().email().safeParse(v).success,
  'El correo no es válido',
);

const updateClientProfileSchema = z.object({
  name: z.string().trim().min(1, 'El nombre del negocio es requerido').max(100),
  rfc: z.string().trim().max(15).regex(/^[A-Za-z0-9&Ññ]*$/, 'El RFC no es válido'),
  phone: z.string().regex(/^\d{10}$/, 'El teléfono debe tener 10 dígitos'),
  email: emailOpcional,
  address: z.string().trim().max(255),
  city: z.string().trim().max(255),
  notes: z.string().trim().max(2000).optional(),
});

const mapear = (c: any, is_owner: boolean, phone: string) => ({
  id_client: c.id_client,
  id_user: c.id_user,
  name: c.name,
  phone,
  rfc: c.rfc,
  email: c.email,
  i_status: c.i_status === 1,
  dt_register: c.dt_register,
  dt_updated: c.dt_updated,
  address: c.address,
  city: c.city,
  addiccional_notes: c.adiccional_notes,
  is_owner,
});

export const registerClientProfileRoutes = (router: Router) => {
  router.get('/client-profile/me', authMiddleware, requireRole(ROLES.ADMIN), async (req: Request, res: Response) => {
    try {
      const id_client = Number(req.user!.id_client);
      if (!id_client) return fail(res, 400, 'No se pudo identificar tu negocio');
      const c = await prisma.clients.findUnique({ where: { id_client } });
      if (!c) return fail(res, 404, 'Negocio no encontrado');
      const dueno = await esDuenoDelNegocio(req.user!.id, id_client);
      let phone = c.phone;
      if (dueno) {
        const yo = await prisma.users.findUnique({ where: { id_user: req.user!.id }, select: { email: true } });
        if (yo) phone = yo.email;
      }
      return ok(res, mapear(c, dueno, phone), 'Cliente obtenido correctamente');
    } catch (error) {
      console.error('GET CLIENT PROFILE ERROR:', (error as any).message);
      return fail(res, 500, 'Error al obtener la información del negocio');
    }
  });

  router.put('/client-profile/me', authMiddleware, requireRole(ROLES.ADMIN), validateBody(updateClientProfileSchema), async (req: Request, res: Response) => {
    try {
      const id_client = Number(req.user!.id_client);
      if (!id_client) return fail(res, 400, 'No se pudo identificar tu negocio');
      const actual = await prisma.clients.findUnique({ where: { id_client } });
      if (!actual) return fail(res, 404, 'Negocio no encontrado');
      if (!(await esDuenoDelNegocio(req.user!.id, id_client))) {
        return fail(res, 403, 'Solo el dueño del negocio puede editar esta información');
      }

      const { name, rfc, phone, email, address, city, notes } = req.body;

      const yo = await prisma.users.findUnique({ where: { id_user: req.user!.id }, select: { email: true } });
      if (yo && phone !== yo.email) {
        const existe = await prisma.users.findUnique({ where: { email: phone }, select: { id_user: true } });
        if (existe && existe.id_user !== req.user!.id) {
          return fail(res, 400, 'Ese número de celular ya está registrado');
        }
      }

      const [c] = await prisma.$transaction([
        prisma.clients.update({
          where: { id_client },
          data: {
            name,
            rfc: String(rfc).toUpperCase(),
            phone,
            email,
            address,
            city,
            adiccional_notes: notes ? notes : null,
            dt_updated: new Date(),
          },
        }),
        prisma.users.update({
          where: { id_user: req.user!.id },
          data: { email: phone, dt_updated: new Date() },
        }),
      ]);
      return ok(res, mapear(c, true, phone), 'Información actualizada exitosamente');
    } catch (error) {
      console.error('UPDATE CLIENT PROFILE ERROR:', (error as any).message);
      return fail(res, 500, 'Error al guardar la información del negocio');
    }
  });
};
