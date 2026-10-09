import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { prisma } from '../../core/prisma'
import { authMiddleware, requireRole, validateBody } from '../../core/middleware'
import { ROLES } from '../../core/constants/status.constants'
import { Utils } from '../../core/utils'

const staffRouter = Router()

// Solo el usuario master (el que no tiene lista de permisos) administra al equipo.
const soloMaster = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = (req as any).user?.id
    const yo = id ? await prisma.users.findUnique({ where: { id_user: Number(id) }, select: { i_rol: true, vc_permisos: true } }) : null
    if (!yo || yo.i_rol !== ROLES.SUPER || yo.vc_permisos !== null) {
      return res.status(403).json({ ok: false, error: 1, data: null, message: 'Solo el usuario master puede administrar al equipo' })
    }
    next()
  } catch (e) {
    res.status(500).json({ ok: false, error: 1, data: null, message: 'Error al validar permisos' })
  }
}

const limpiarPermisos = (lista: string[]) =>
  Array.from(new Set(lista.map((r) => r.trim()).filter((r) => r.startsWith('/'))))

const leerPermisos = (txt: string | null): string[] | null => {
  if (txt === null) return null
  try { const v = JSON.parse(txt); return Array.isArray(v) ? v : [] } catch { return [] }
}

const campos = { id_user: true, email: true, name: true, lastname: true, i_status: true, vc_permisos: true, dt_register: true }
const formato = (u: any) => ({ ...u, permisos: leerPermisos(u.vc_permisos), vc_permisos: undefined })

const crearSchema = z.object({
  name: z.string().min(1, 'name es requerido'),
  lastname: z.string().min(1, 'lastname es requerido'),
  email: z.string().min(3, 'El usuario (correo o celular) es requerido'),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres'),
  permisos: z.array(z.string()),
})

const editarSchema = z.object({
  name: z.string().min(1).optional(),
  lastname: z.string().min(1).optional(),
  permisos: z.array(z.string()).optional(),
  i_status: z.number().int().min(0).max(1).optional(),
})

staffRouter.get('/', authMiddleware, requireRole(ROLES.SUPER), soloMaster, async (_req: Request, res: Response) => {
  try {
    const lista = await prisma.users.findMany({ where: { i_rol: ROLES.SUPER }, select: campos, orderBy: { dt_register: 'asc' } })
    res.status(200).json({ ok: true, error: 0, data: lista.map(formato), message: 'Equipo obtenido' })
  } catch (e) {
    res.status(500).json({ ok: false, error: 1, data: null, message: 'Error al obtener el equipo' })
  }
})

staffRouter.post('/', authMiddleware, requireRole(ROLES.SUPER), soloMaster, validateBody(crearSchema), async (req: Request, res: Response) => {
  try {
    const { name, lastname, email, password, permisos } = req.body
    const ya = await prisma.users.findUnique({ where: { email }, select: { id_user: true } })
    if (ya) return res.status(400).json({ ok: false, error: 1, data: null, message: 'Ese usuario ya está registrado' })
    const nuevo = await prisma.users.create({
      data: {
        email, name, lastname,
        password: await Utils.hash_password(password),
        i_rol: ROLES.SUPER,
        i_status: 1,
        must_change_password: true,
        id_client: 0,
        id_user_creator: Number((req as any).user?.id),
        vc_permisos: JSON.stringify(limpiarPermisos(permisos)),
      },
      select: campos,
    })
    res.status(201).json({ ok: true, error: 0, data: formato(nuevo), message: 'Usuario creado' })
  } catch (e) {
    res.status(500).json({ ok: false, error: 1, data: null, message: 'Error al crear el usuario' })
  }
})

staffRouter.put('/:id_user', authMiddleware, requireRole(ROLES.SUPER), soloMaster, validateBody(editarSchema), async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id_user)
    const destino = await prisma.users.findUnique({ where: { id_user: id }, select: { i_rol: true, vc_permisos: true } })
    if (!destino || destino.i_rol !== ROLES.SUPER) return res.status(404).json({ ok: false, error: 1, data: null, message: 'Usuario no encontrado' })
    if (destino.vc_permisos === null) return res.status(403).json({ ok: false, error: 1, data: null, message: 'No se puede editar al usuario master' })
    const { name, lastname, permisos, i_status } = req.body
    const actualizado = await prisma.users.update({
      where: { id_user: id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(lastname !== undefined ? { lastname } : {}),
        ...(i_status !== undefined ? { i_status } : {}),
        ...(permisos !== undefined ? { vc_permisos: JSON.stringify(limpiarPermisos(permisos)) } : {}),
      },
      select: campos,
    })
    res.status(200).json({ ok: true, error: 0, data: formato(actualizado), message: 'Usuario actualizado' })
  } catch (e) {
    res.status(500).json({ ok: false, error: 1, data: null, message: 'Error al actualizar el usuario' })
  }
})

export default staffRouter
