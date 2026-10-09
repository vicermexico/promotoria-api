import { Request, Response, NextFunction } from "express";
import { Utils, TokenPayload } from '../../core/utils';
import { prisma } from '../prisma';

declare global {
    namespace Express {
        interface Request {
            user?: TokenPayload;
        }
    }
}

/**
 * Middleware para verificar la autenticación mediante JWT
 */
export const authMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authHeader = req.headers.authorization;

      if (!authHeader) {
        res.status(401).json({
          ok: false,
          data: null,
          message: 'Acceso denegado. Token no proporcionado.'
        });
        return;
      }

      if (!authHeader.startsWith('Bearer ')) {
        res.status(401).json({
          ok: false,
          data: null,
          message: 'Formato de token inválido. Utilice Bearer {token}'
        });
        return;
      }

      const token = authHeader.split(' ')[1];

      const decoded = await Utils.verify_token(token);

      // Los tokens de promotor son JWT sin registro en servidor (no hay
      // tabla de sesiones), asi que no se pueden "apagar" antes de su
      // expiracion (30-90 dias) por si solos. Para cumplir con el requisito
      // de revocar la sesion al eliminar la cuenta, verificamos aqui mismo
      // si el promotor ya solicito su baja (dt_deleted) y, de ser asi,
      // rechazamos la peticion aunque el JWT siga siendo tecnicamente
      // valido. Se detecta un token de promotor porque trae "phone" (los
      // tokens de usuarios del panel no traen ese campo).
      if ((decoded as any)?.phone && (decoded as any)?.id) {
        const promoter = await prisma.promoters.findUnique({
          where: { id: (decoded as any).id },
          select: { dt_deleted: true },
        })
        if (promoter?.dt_deleted) {
          res.status(401).json({
            ok: false,
            data: null,
            message: 'Esta cuenta fue eliminada. Inicia sesión con una cuenta activa.'
          });
          return;
        }
      }

      // Cuentas del panel suspendidas o eliminadas: se corta la sesión abierta.
      if (!(decoded as any)?.phone && (decoded as any)?.id && (decoded as any)?.email) {
        const panelUser = await prisma.users.findUnique({
          where: { id_user: Number((decoded as any).id) },
          select: { email: true, i_status: true },
        })
        if (panelUser) {
          const tokenEmail = String((decoded as any).email)
          const suspendido = panelUser.i_status === 0 && panelUser.email === tokenEmail
          const eliminado = panelUser.i_status === 2 && panelUser.email.startsWith(tokenEmail + '#del')
          if (suspendido || eliminado) {
            res.status(401).json({
              ok: false,
              data: null,
              message: 'Tu cuenta está suspendida o fue eliminada. Contacta al administrador de tu negocio.'
            });
            return;
          }
        }
      }

      req.user = decoded;

      next();
    } catch (error) {
      res.status(401).json({
        ok: false,
        data: null,
        message: 'Token inválido o expirado'
      });
    }
  };

/**
 * Middleware para verificar roles de usuario
 * @param allowedRoles Array de roles permitidos
 */
export const roleMiddleware = (allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      // Verificar que el usuario esté autenticado
      if (!req.user) {
        return res.status(401).json({
          ok: false,
          data: null,
          message: 'Usuario no autenticado'
        });
      }

      // Verificar si el rol del usuario está permitido
      // Nota: Debes agregar el campo 'role' a tu TokenPayload si quieres usar esta función
      const userRole = (req.user as any).role;
      
      if (!userRole || !allowedRoles.includes(userRole)) {
        return res.status(403).json({
          ok: false,
          data: null,
          message: 'Acceso denegado. No tienes los permisos necesarios'
        });
      }

      // Si el rol está permitido, continuar
      next();
    } catch (error) {
      console.error('Error en el middleware de roles:', error);
      return res.status(500).json({
        ok: false,
        data: null,
        message: 'Error interno del servidor'
      });
    }
  };
};