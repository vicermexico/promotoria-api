import { prisma } from '../../core/prisma'
import { StorageService } from '../../services/storage.service'
import {
    INICIO_CONFIG_LIMITES, INICIO_CONFIG_URLS, INICIO_SECCIONES,
    InicioArchivoDTO, InicioClienteDTO, InicioConfigDTO, InicioDatosDTO, InicioFondoDTO,
    InicioPersonajeDTO, InicioSeccion, InicioTipoMedia, UpdateInicioConfigDTO,
} from './inicio.dto'

/** Error de validacion (el controller lo responde como 400). */
export class InicioError extends Error {}

const ID_CONFIG = 1
const MIMES_PERSONAJE = ['image/png', 'image/webp'] // con transparencia

function slug(name: string): string {
    return name
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase()
        .slice(0, 60)
}

function tipoDeMime(mime: string): InicioTipoMedia {
    if (mime.startsWith('image/')) return 'imagen'
    if (mime.startsWith('video/')) return 'video'
    throw new InicioError('Solo se permiten imágenes o videos')
}

/** Texto opcional: recorta, vacio -> null, y valida largo. */
function textoOpcional(valor: unknown, max: number, campo: string): string | null {
    if (valor === undefined || valor === null) return null
    const t = String(valor).trim()
    if (!t) return null
    if (t.length > max) throw new InicioError(`"${campo}" no puede pasar de ${max} caracteres`)
    return t
}

/** Enlace opcional: solo http(s) (se muestra como link en la portada; no se aceptan javascript: ni similares). */
function urlOpcional(valor: unknown, max: number, campo: string): string | null {
    const t = textoOpcional(valor, max, campo)
    if (t === null) return null
    let u: URL
    try { u = new URL(t) } catch { throw new InicioError(`"${campo}" no es un enlace válido`) }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        throw new InicioError(`"${campo}" debe empezar con http:// o https://`)
    }
    return t
}

export class Inicio {
    // ---------------------------------------------------------------- lectura pública

    async getDatos(): Promise<InicioDatosDTO> {
        const where = { is_active: true }
        const [fondos, personajes, clientes, config] = await Promise.all([
            prisma.landing_fondos.findMany({ where, orderBy: [{ i_order: 'asc' }, { id_landing_fondo: 'asc' }] }),
            prisma.landing_personajes.findMany({ where, orderBy: [{ i_order: 'asc' }, { id_landing_personaje: 'asc' }] }),
            prisma.landing_clientes.findMany({ where, orderBy: [{ i_order: 'asc' }, { id_landing_cliente: 'asc' }] }),
            this.getConfig(),
        ])
        return {
            fondos: fondos.map((f): InicioFondoDTO => ({ id: f.id_landing_fondo, tipo: f.vc_tipo as InicioTipoMedia, url: f.vc_url })),
            personajes: personajes.map((p): InicioPersonajeDTO => ({ id: p.id_landing_personaje, nombre: p.vc_nombre, puesto: p.vc_puesto, url: p.vc_url })),
            clientes: clientes.map((c): InicioClienteDTO => ({ id: c.id_landing_cliente, nombre: c.vc_nombre, tipo: c.vc_tipo as InicioTipoMedia, url: c.vc_url, enlace: c.vc_enlace })),
            config,
        }
    }

    async getConfig(): Promise<InicioConfigDTO> {
        const c = await prisma.landing_config.findUnique({ where: { id_landing_config: ID_CONFIG } })
        return {
            titulo: c?.vc_titulo ?? null,
            telefono: c?.vc_telefono ?? null,
            whatsapp: c?.vc_whatsapp ?? null,
            correo: c?.vc_correo ?? null,
            direccion: c?.vc_direccion ?? null,
            horario: c?.vc_horario ?? null,
            sitio_web: c?.vc_sitio_web ?? null,
            instagram_url: c?.vc_instagram_url ?? null,
            facebook_url: c?.vc_facebook_url ?? null,
            tiktok_url: c?.vc_tiktok_url ?? null,
            youtube_url: c?.vc_youtube_url ?? null,
            x_url: c?.vc_x_url ?? null,
            linkedin_url: c?.vc_linkedin_url ?? null,
            dev_nombre: c?.vc_dev_nombre ?? null,
            dev_whatsapp: c?.vc_dev_whatsapp ?? null,
        }
    }

    // ---------------------------------------------------------------- config

    async updateConfig(payload: UpdateInicioConfigDTO): Promise<InicioConfigDTO> {
        const data: Record<string, string | null> = {}
        for (const campo of Object.keys(INICIO_CONFIG_LIMITES) as Array<keyof InicioConfigDTO>) {
            // Solo se tocan los campos que vienen en el body; el resto queda como esta.
            if (!(campo in payload)) continue
            const max = INICIO_CONFIG_LIMITES[campo]
            data[`vc_${campo}`] = INICIO_CONFIG_URLS.includes(campo)
                ? urlOpcional(payload[campo], max, campo)
                : textoOpcional(payload[campo], max, campo)
        }
        await prisma.landing_config.upsert({
            where: { id_landing_config: ID_CONFIG },
            create: { id_landing_config: ID_CONFIG, ...data },
            update: data,
        })
        return this.getConfig()
    }

    // ---------------------------------------------------------------- fondos

    async addFondo(archivo: InicioArchivoDTO): Promise<InicioFondoDTO> {
        const tipo = tipoDeMime(archivo.mime)
        const subido = await this.subir(archivo, 'fondos')
        const fondo = await prisma.landing_fondos.create({
            data: { vc_tipo: tipo, vc_url: subido.url, vc_bucket_path: subido.path, i_order: await this.siguienteOrden('fondos') },
        })
        return { id: fondo.id_landing_fondo, tipo, url: fondo.vc_url }
    }

    async deleteFondo(id: number) {
        // Borrado logico (el archivo se queda en el bucket).
        const r = await prisma.landing_fondos.updateMany({ where: { id_landing_fondo: id, is_active: true }, data: { is_active: false } })
        if (r.count === 0) throw new InicioError('Fondo no encontrado')
        return { deleted: true }
    }

    // ---------------------------------------------------------------- personajes

    async addPersonaje(archivo: InicioArchivoDTO, nombre: unknown, puesto: unknown): Promise<InicioPersonajeDTO> {
        this.validarImagenPersonaje(archivo)
        const vc_nombre = textoOpcional(nombre, 100, 'nombre')
        const vc_puesto = textoOpcional(puesto, 100, 'puesto')
        const subido = await this.subir(archivo, 'personajes')
        const p = await prisma.landing_personajes.create({
            data: { vc_nombre, vc_puesto, vc_url: subido.url, vc_bucket_path: subido.path, i_order: await this.siguienteOrden('personajes') },
        })
        return { id: p.id_landing_personaje, nombre: p.vc_nombre, puesto: p.vc_puesto, url: p.vc_url }
    }

    async updatePersonaje(id: number, body: { nombre?: unknown, puesto?: unknown }, archivo?: InicioArchivoDTO): Promise<InicioPersonajeDTO> {
        const actual = await prisma.landing_personajes.findFirst({ where: { id_landing_personaje: id, is_active: true } })
        if (!actual) throw new InicioError('Personaje no encontrado')

        const data: { vc_nombre?: string | null, vc_puesto?: string | null, vc_url?: string, vc_bucket_path?: string } = {}
        if ('nombre' in body) data.vc_nombre = textoOpcional(body.nombre, 100, 'nombre')
        if ('puesto' in body) data.vc_puesto = textoOpcional(body.puesto, 100, 'puesto')
        if (archivo) {
            this.validarImagenPersonaje(archivo)
            const subido = await this.subir(archivo, 'personajes')
            data.vc_url = subido.url
            data.vc_bucket_path = subido.path
        }

        const p = await prisma.landing_personajes.update({ where: { id_landing_personaje: id }, data })
        // Reemplazo de foto: se quita la anterior del bucket para no dejar archivos huerfanos.
        if (archivo) await StorageService.deleteRawFile(actual.vc_bucket_path).catch(() => undefined)
        return { id: p.id_landing_personaje, nombre: p.vc_nombre, puesto: p.vc_puesto, url: p.vc_url }
    }

    async deletePersonaje(id: number) {
        const r = await prisma.landing_personajes.updateMany({ where: { id_landing_personaje: id, is_active: true }, data: { is_active: false } })
        if (r.count === 0) throw new InicioError('Personaje no encontrado')
        return { deleted: true }
    }

    // ---------------------------------------------------------------- clientes

    async addCliente(archivo: InicioArchivoDTO, nombre: unknown, enlace: unknown): Promise<InicioClienteDTO> {
        const tipo = tipoDeMime(archivo.mime)
        const vc_nombre = textoOpcional(nombre, 150, 'nombre')
        if (!vc_nombre) throw new InicioError('El nombre del cliente es requerido')
        const vc_enlace = urlOpcional(enlace, 500, 'enlace')
        const subido = await this.subir(archivo, 'clientes')
        const c = await prisma.landing_clientes.create({
            data: { vc_nombre, vc_tipo: tipo, vc_url: subido.url, vc_bucket_path: subido.path, vc_enlace, i_order: await this.siguienteOrden('clientes') },
        })
        return { id: c.id_landing_cliente, nombre: c.vc_nombre, tipo, url: c.vc_url, enlace: c.vc_enlace }
    }

    async updateCliente(id: number, body: { nombre?: unknown, enlace?: unknown }, archivo?: InicioArchivoDTO): Promise<InicioClienteDTO> {
        const actual = await prisma.landing_clientes.findFirst({ where: { id_landing_cliente: id, is_active: true } })
        if (!actual) throw new InicioError('Cliente no encontrado')

        const data: { vc_nombre?: string, vc_enlace?: string | null, vc_tipo?: string, vc_url?: string, vc_bucket_path?: string } = {}
        if ('nombre' in body) {
            const n = textoOpcional(body.nombre, 150, 'nombre')
            if (!n) throw new InicioError('El nombre del cliente es requerido')
            data.vc_nombre = n
        }
        if ('enlace' in body) data.vc_enlace = urlOpcional(body.enlace, 500, 'enlace')
        if (archivo) {
            data.vc_tipo = tipoDeMime(archivo.mime)
            const subido = await this.subir(archivo, 'clientes')
            data.vc_url = subido.url
            data.vc_bucket_path = subido.path
        }

        const c = await prisma.landing_clientes.update({ where: { id_landing_cliente: id }, data })
        if (archivo) await StorageService.deleteRawFile(actual.vc_bucket_path).catch(() => undefined)
        return { id: c.id_landing_cliente, nombre: c.vc_nombre, tipo: c.vc_tipo as InicioTipoMedia, url: c.vc_url, enlace: c.vc_enlace }
    }

    async deleteCliente(id: number) {
        const r = await prisma.landing_clientes.updateMany({ where: { id_landing_cliente: id, is_active: true }, data: { is_active: false } })
        if (r.count === 0) throw new InicioError('Cliente no encontrado')
        return { deleted: true }
    }

    // ---------------------------------------------------------------- orden

    static esSeccionValida(seccion: string): seccion is InicioSeccion {
        return (INICIO_SECCIONES as readonly string[]).includes(seccion)
    }

    /** Reordena una seccion. `ids` debe traer exactamente los elementos activos de la seccion. */
    async reordenar(seccion: InicioSeccion, ids: number[]) {
        const existentes = await this.idsActivos(seccion)
        const set = new Set(existentes)
        if (ids.length !== existentes.length || new Set(ids).size !== ids.length || !ids.every((id) => set.has(id))) {
            throw new InicioError('La lista de ids no coincide con los elementos de esta sección')
        }
        if (seccion === 'fondos') {
            await prisma.$transaction(ids.map((id, i) => prisma.landing_fondos.update({ where: { id_landing_fondo: id }, data: { i_order: i } })))
        } else if (seccion === 'personajes') {
            await prisma.$transaction(ids.map((id, i) => prisma.landing_personajes.update({ where: { id_landing_personaje: id }, data: { i_order: i } })))
        } else {
            await prisma.$transaction(ids.map((id, i) => prisma.landing_clientes.update({ where: { id_landing_cliente: id }, data: { i_order: i } })))
        }
        return { reordered: true }
    }

    // ---------------------------------------------------------------- internos

    private validarImagenPersonaje(archivo: InicioArchivoDTO) {
        if (!MIMES_PERSONAJE.includes(archivo.mime)) {
            throw new InicioError('La foto del personaje debe ser PNG o WebP con fondo transparente (ya recortada)')
        }
    }

    // Se sube sin optimizar para no perder la transparencia ni calidad del recorte.
    private async subir(archivo: InicioArchivoDTO, carpeta: 'fondos' | 'personajes' | 'clientes') {
        const ext = (archivo.originalName.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin'
        const rand = Math.random().toString(36).slice(2, 8)
        const base = slug(archivo.originalName.replace(/\.[^.]+$/, '')) || 'archivo'
        return StorageService.uploadRawFile(archivo.buffer, archivo.mime, `landing/${carpeta}/${Date.now()}-${rand}-${base}.${ext}`)
    }

    private async idsActivos(seccion: InicioSeccion): Promise<number[]> {
        if (seccion === 'fondos') return (await prisma.landing_fondos.findMany({ where: { is_active: true }, select: { id_landing_fondo: true } })).map((r) => r.id_landing_fondo)
        if (seccion === 'personajes') return (await prisma.landing_personajes.findMany({ where: { is_active: true }, select: { id_landing_personaje: true } })).map((r) => r.id_landing_personaje)
        return (await prisma.landing_clientes.findMany({ where: { is_active: true }, select: { id_landing_cliente: true } })).map((r) => r.id_landing_cliente)
    }

    private async siguienteOrden(seccion: InicioSeccion): Promise<number> {
        const where = { is_active: true }
        const max = seccion === 'fondos' ? await prisma.landing_fondos.aggregate({ where, _max: { i_order: true } })
            : seccion === 'personajes' ? await prisma.landing_personajes.aggregate({ where, _max: { i_order: true } })
            : await prisma.landing_clientes.aggregate({ where, _max: { i_order: true } })
        return (max._max.i_order ?? -1) + 1
    }
}
