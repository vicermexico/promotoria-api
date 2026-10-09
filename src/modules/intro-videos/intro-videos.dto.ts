export const INTRO_VIDEO_CHECKPOINTS = [
    { key: 'fotos_antes', label: 'Fotos — antes de tomar fotos' },
    { key: 'fotos_post_foto1', label: 'Fotos — después de la 1ª foto' },
    { key: 'fotos_post_foto2', label: 'Fotos — después de la 2ª foto' },
    { key: 'preguntas', label: 'Preguntas' },
    { key: 'preventa', label: 'Preventa (levantar pedido)' },
] as const

export type IntroVideoCheckpointKey = typeof INTRO_VIDEO_CHECKPOINTS[number]['key']

export const INTRO_VIDEO_CHECKPOINT_KEYS: string[] = INTRO_VIDEO_CHECKPOINTS.map(c => c.key)

export interface IntroVideoClipDTO {
    id_clip: number
    vc_checkpoint_key: string
    vc_url: string
    i_order: number
    dt_register: Date
}

export interface IntroVideoCheckpointStateDTO {
    key: string
    label: string
    clips: IntroVideoClipDTO[]
    processed_url: string | null
    /** true si hay clips nuevos/borrados/reordenados desde el último procesado. */
    needs_reprocessing: boolean
}

export interface ReorderClipsDTO {
    ids: number[]
}
