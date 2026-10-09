import { Router, Request, Response } from 'express'
import { prisma } from '../../core/prisma'
import { ROLES } from '../../core/constants/status.constants'
import { authMiddleware, requireRole } from '../../core/middleware'
import { Store } from './store.service'
import { CreateStoreDTO } from './store.dto'

const ok = (res: Response, data: any, message: string) =>
  res.status(200).json({ ok: true, error: 0, data, message })
const fail = (res: Response, status: number, message: string) =>
  res.status(status).json({ ok: false, error: 1, data: null, message })

const toNum = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const metros = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371000
  const rad = (x: number) => (x * Math.PI) / 180
  const dLat = rad(lat2 - lat1)
  const dLon = rad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

/**
 * Una tienda se considera repetida si:
 *  - tiene el mismo codigo de tienda y el mismo canal, o
 *  - tiene el mismo nombre y esta a 100 m o menos (o, sin coordenadas, en el mismo municipio).
 */
export async function buscarDuplicada(input: {
  name: string
  store_code?: string | null
  id_channel_sale?: number | null
  address: { id_city?: number | null; latitude?: any; longitude?: any }
}) {
  const code = (input.store_code ?? '').trim()
  if (code) {
    const porCodigo = await prisma.stores.findFirst({
      where: { i_status: 1, store_code: code, id_channel_sale: input.id_channel_sale ?? null },
    })
    if (porCodigo) return porCodigo
  }

  const name = (input.name ?? '').trim()
  if (!name) return null

  const candidatas = await prisma.stores.findMany({ where: { i_status: 1, name }, take: 50 })
  const lat = toNum(input.address?.latitude)
  const lng = toNum(input.address?.longitude)

  for (const c of candidatas) {
    const dir = await prisma.addresses.findFirst({
      where: { entity_type: 'store', entity_id: c.id_store, is_active: true },
    })
    if (!dir) continue
    const clat = toNum(dir.latitude)
    const clng = toNum(dir.longitude)
    if (lat !== null && lng !== null && clat !== null && clng !== null) {
      if (metros(lat, lng, clat, clng) <= 100) return c
    } else if (input.address?.id_city && dir.id_city === input.address.id_city) {
      return c
    }
  }
  return null
}

/** Si la tienda ya existe en el global no se duplica: solo se liga al cliente. */
export async function crearOVincularTienda(id_client: number, payload: CreateStoreDTO) {
  const dup = await buscarDuplicada({
    name: payload.name,
    store_code: payload.store_code,
    id_channel_sale: payload.id_channel_sale,
    address: payload.address as any,
  })
  const store = dup ?? (await new Store().createStore(payload))
  await prisma.client_stores.upsert({
    where: { id_client_id_store: { id_client, id_store: store.id_store } },
    update: {},
    create: { id_client, id_store: store.id_store },
  })
  return { store, ya_existia: !!dup }
}

export function registerClientStoreRoutes(router: Router) {
  const miCliente = (req: Request): number | null => {
    const n = Number((req as any).user?.id_client)
    return Number.isInteger(n) && n > 0 ? n : null
  }

  // Mis establecimientos (los ligados a mi cliente)
  router.get('/mine/list', authMiddleware, requireRole(ROLES.ADMIN), async (req: Request, res: Response) => {
    const id_client = miCliente(req)
    if (!id_client) return fail(res, 403, 'Tu usuario no pertenece a un negocio')
    try {
      const data = await new Store().getStores(id_client)
      return ok(res, data, 'Establecimientos obtenidos exitosamente')
    } catch (e) {
      console.error('GET /stores/mine/list', e)
      return fail(res, 500, 'Error al obtener tus establecimientos')
    }
  })

  // Buscar en el catalogo global (marca cuales ya son mias)
  router.get('/catalog/search', authMiddleware, requireRole(ROLES.ADMIN), async (req: Request, res: Response) => {
    const id_client = miCliente(req)
    if (!id_client) return fail(res, 403, 'Tu usuario no pertenece a un negocio')
    try {
      const q = String(req.query.q ?? '').trim()
      const id_state = toNum(req.query.id_state)
      const id_city = toNum(req.query.id_city)
      const limit = Math.min(Math.max(toNum(req.query.limit) ?? 30, 1), 100)
      if (q.length < 2 && !id_state && !id_city) {
        return fail(res, 400, 'Escribe al menos 2 letras o elige un estado o municipio')
      }

      let ids: number[] | undefined
      if (id_state || id_city) {
        const dirs = await prisma.addresses.findMany({
          where: {
            entity_type: 'store',
            is_active: true,
            ...(id_state ? { id_state } : {}),
            ...(id_city ? { id_city } : {}),
          },
          select: { entity_id: true },
          take: 5000,
        })
        ids = dirs.map((d) => d.entity_id)
      }

      const stores = await prisma.stores.findMany({
        where: {
          i_status: 1,
          ...(q.length >= 2 ? { OR: [{ name: { contains: q } }, { store_code: { contains: q } }] } : {}),
          ...(ids ? { id_store: { in: ids } } : {}),
        },
        include: { sales_channel: { select: { name: true, url_image: true } } },
        orderBy: { name: 'asc' },
        take: limit,
      })

      const idsStores = stores.map((s) => s.id_store)
      const mias = new Set(
        (await prisma.client_stores.findMany({
          where: { id_client, id_store: { in: idsStores } },
          select: { id_store: true },
        })).map((x) => x.id_store),
      )
      const dirs2 = await prisma.addresses.findMany({
        where: { entity_type: 'store', is_active: true, entity_id: { in: idsStores } },
        include: { state: { select: { id: true, name: true } }, city: { select: { id: true, name: true } } },
      })
      const dirPor = new Map(dirs2.map((d) => [d.entity_id, d]))

      const data = stores.map((s) => {
        const d: any = dirPor.get(s.id_store)
        return {
          id_store: s.id_store,
          name: s.name,
          store_code: s.store_code,
          sales_channel: s.sales_channel,
          address: d
            ? {
                street: d.street,
                ext_number: d.ext_number,
                neighborhood: d.neighborhood,
                postal_code: d.postal_code,
                latitude: d.latitude,
                longitude: d.longitude,
                state: d.state,
                city: d.city,
              }
            : null,
          mine: mias.has(s.id_store),
        }
      })
      return ok(res, data, 'Catálogo obtenido exitosamente')
    } catch (e) {
      console.error('GET /stores/catalog/search', e)
      return fail(res, 500, 'Error al buscar en el catálogo')
    }
  })

  // Agregar una tienda del global a las mias
  router.post('/mine/:id_store', authMiddleware, requireRole(ROLES.ADMIN), async (req: Request, res: Response) => {
    const id_client = miCliente(req)
    if (!id_client) return fail(res, 403, 'Tu usuario no pertenece a un negocio')
    const id_store = toNum(req.params.id_store)
    if (!id_store) return fail(res, 400, 'Tienda inválida')
    try {
      const existe = await prisma.stores.findFirst({ where: { id_store, i_status: 1 } })
      if (!existe) return fail(res, 404, 'La tienda no existe')
      await prisma.client_stores.upsert({
        where: { id_client_id_store: { id_client, id_store } },
        update: {},
        create: { id_client, id_store },
      })
      return ok(res, { id_store }, 'Tienda agregada a tus establecimientos')
    } catch (e) {
      console.error('POST /stores/mine/:id', e)
      return fail(res, 500, 'Error al agregar la tienda')
    }
  })

  // Quitar una tienda de las mias (NO borra la tienda del global)
  router.delete('/mine/:id_store', authMiddleware, requireRole(ROLES.ADMIN), async (req: Request, res: Response) => {
    const id_client = miCliente(req)
    if (!id_client) return fail(res, 403, 'Tu usuario no pertenece a un negocio')
    const id_store = toNum(req.params.id_store)
    if (!id_store) return fail(res, 400, 'Tienda inválida')
    try {
      await prisma.client_stores.deleteMany({ where: { id_client, id_store } })
      return ok(res, { id_store }, 'Tienda quitada de tus establecimientos')
    } catch (e) {
      console.error('DELETE /stores/mine/:id', e)
      return fail(res, 500, 'Error al quitar la tienda')
    }
  })
}
