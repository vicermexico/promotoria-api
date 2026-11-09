export type InicioTipoMedia = 'imagen' | 'video'

export const INICIO_SECCIONES = ['fondos', 'personajes', 'clientes'] as const
export type InicioSeccion = typeof INICIO_SECCIONES[number]

// Contrato que consume el front de la portada (panel/src/modules/landing/tipos.ts).
export interface InicioFondoDTO { id: number, tipo: InicioTipoMedia, url: string }
export interface InicioPersonajeDTO { id: number, nombre: string | null, puesto: string | null, url: string }
export interface InicioClienteDTO { id: number, nombre: string, tipo: InicioTipoMedia, url: string, enlace: string | null }

export interface InicioConfigDTO {
    titulo: string | null
    telefono: string | null
    whatsapp: string | null
    correo: string | null
    direccion: string | null
    horario: string | null
    sitio_web: string | null
    instagram_url: string | null
    facebook_url: string | null
    tiktok_url: string | null
    youtube_url: string | null
    x_url: string | null
    linkedin_url: string | null
    dev_nombre: string | null
    dev_whatsapp: string | null
}

export interface InicioDatosDTO {
    fondos: InicioFondoDTO[]
    personajes: InicioPersonajeDTO[]
    clientes: InicioClienteDTO[]
    config: InicioConfigDTO
}

export type UpdateInicioConfigDTO = Partial<InicioConfigDTO>

export interface InicioArchivoDTO { buffer: Buffer, mime: string, originalName: string }

// Longitud maxima de cada campo de config (igual a las columnas de landing_config).
export const INICIO_CONFIG_LIMITES: Record<keyof InicioConfigDTO, number> = {
    titulo: 200, telefono: 30, whatsapp: 30, correo: 150, direccion: 300, horario: 200,
    sitio_web: 300, instagram_url: 300, facebook_url: 300, tiktok_url: 300, youtube_url: 300,
    x_url: 300, linkedin_url: 300, dev_nombre: 100, dev_whatsapp: 30,
}

// Campos que se muestran como enlace en la portada: solo http(s).
export const INICIO_CONFIG_URLS: Array<keyof InicioConfigDTO> = [
    'sitio_web', 'instagram_url', 'facebook_url', 'tiktok_url', 'youtube_url', 'x_url', 'linkedin_url',
]
