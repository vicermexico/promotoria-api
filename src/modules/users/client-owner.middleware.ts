import { prisma } from "../../core/prisma" 
import { ROLES } from "../../core/constants/status.constants"
import { Request, Response, NextFunction } from 'express';

// IDs de los usuarios "cliente" (rol administrador) de un negocio.
export const idsAdmins = async (id_client: number): Promise<number[]> => {
  const us = await prisma.users.findMany({
    where: { id_client, i_rol: ROLES.ADMIN },
    select: { id_user: true },
  });
  return us.map((u: any) => u.id_user);
};

// Dueño = usuario del negocio que NO fue creado por otro usuario del mismo negocio
// (o sea, lo dio de alta el super admin). Empleado = lo creó un usuario del negocio.
export const esDuenoDelNegocio = async (id_user: number, id_client: number): Promise<boolean> => {
  if (!id_client) return false;
  const u = await prisma.users.findFirst({
    where: { id_user, id_client, i_rol: ROLES.ADMIN },
    select: { id_user: true, id_user_creator: true },
  });
  if (!u) return false;
  const ids = await idsAdmins(id_client);
  return !ids.includes(u.id_user_creator);
};

export const requireClientOwner = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const dueno = await esDuenoDelNegocio(req.user!.id, Number(req.user!.id_client));
    if (!dueno) {
      res.status(403).json({ ok: false, error: 1, data: null, message: 'Solo el dueño del negocio puede hacer esto' });
      return;
    }
    next();
  } catch (error) {
    console.error('OWNER CHECK ERROR:', (error as any).message);
    res.status(500).json({ ok: false, error: 1, data: null, message: 'Error al verificar permisos' });
  }
};
