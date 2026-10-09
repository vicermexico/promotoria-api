import { prisma } from '../../core/prisma'
import { StorageService } from '../../services/storage.service'
import { INTRO_VIDEO_CHECKPOINTS, INTRO_VIDEO_CHECKPOINT_KEYS, IntroVideoCheckpointStateDTO } from './intro-videos.dto'
import { execFile } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { randomUUID } from 'crypto'

const execFileAsync = promisify(execFile)

const SETTING_PREFIX = 'intro_video_processed_'

function slugifyName(name: string): string {
    return name
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase()
        .slice(0, 60)
}

export class IntroVideosService {
    static isValidCheckpoint(key: string): boolean {
        return INTRO_VIDEO_CHECKPOINT_KEYS.includes(key)
    }

    /**
     * Devuelve, para un checkpoint, la URL procesada (video ya unido) y la
     * "firma" (ids de clip en orden) con la que se generó — para saber si ya
     * quedó desactualizada por un cambio posterior en los clips.
     */
    private static async getProcessedSetting(key: string): Promise<{ url: string, signature: string, dt_processed: string } | null> {
        const setting = await prisma.app_settings.findUnique({ where: { vc_key: `${SETTING_PREFIX}${key}` } })
        if (!setting) return null
        try {
            return JSON.parse(setting.vc_value)
        } catch {
            return null
        }
    }

    async listAll(): Promise<IntroVideoCheckpointStateDTO[]> {
        const allClips = await prisma.intro_video_clips.findMany({
            where: { vc_checkpoint_key: { in: INTRO_VIDEO_CHECKPOINT_KEYS } },
            orderBy: [{ vc_checkpoint_key: 'asc' }, { i_order: 'asc' }],
        })

        const result: IntroVideoCheckpointStateDTO[] = []
        for (const cp of INTRO_VIDEO_CHECKPOINTS) {
            const clips = allClips.filter(c => c.vc_checkpoint_key === cp.key)
            const processed = await IntroVideosService.getProcessedSetting(cp.key)
            const currentSignature = clips.map(c => c.id_clip).join(',')
            result.push({
                key: cp.key,
                label: cp.label,
                clips,
                processed_url: processed?.url ?? null,
                needs_reprocessing: clips.length > 0 && (!processed || processed.signature !== currentSignature),
            })
        }
        return result
    }

    /**
     * Version ligera de listAll(), solo con lo que necesita la app del
     * promotor: la clave del checkpoint y la URL del video ya unido (si
     * existe). No expone clips individuales ni estado de "falta unir".
     */
    async listForPromoter(): Promise<{ key: string, url: string }[]> {
        const result: { key: string, url: string }[] = []
        for (const cp of INTRO_VIDEO_CHECKPOINTS) {
            const processed = await IntroVideosService.getProcessedSetting(cp.key)
            if (processed?.url) {
                result.push({ key: cp.key, url: processed.url })
            }
        }
        return result
    }

    async addClip(checkpointKey: string, buffer: Buffer, mime: string, originalName: string) {
        if (!IntroVideosService.isValidCheckpoint(checkpointKey)) {
            throw new Error('Checkpoint inválido')
        }

        const maxOrder = await prisma.intro_video_clips.aggregate({
            where: { vc_checkpoint_key: checkpointKey },
            _max: { i_order: true },
        })
        const nextOrder = (maxOrder._max.i_order ?? -1) + 1

        const ext = (originalName.split('.').pop() || 'mp4').toLowerCase()
        const rand = Math.random().toString(36).slice(2, 8)
        const objectPath = `intro_videos/${checkpointKey}/${Date.now()}-${rand}-${slugifyName(originalName)}.${ext}`

        const { url, path } = await StorageService.uploadRawFile(buffer, mime, objectPath)

        const clip = await prisma.intro_video_clips.create({
            data: {
                vc_checkpoint_key: checkpointKey,
                vc_url: url,
                vc_bucket_path: path,
                i_order: nextOrder,
            },
        })

        // Se une automáticamente cada vez que cambian los clips de un
        // checkpoint, para que el master nunca tenga que darle a un botón
        // aparte de "unir". Si falla (ej. ffmpeg no instalado), no tumba la
        // subida: solo se queda pendiente y listAll() lo marcará con el
        // badge de "Falta unir los clips".
        try {
            await this.processCheckpoint(checkpointKey)
        } catch (error) {
            console.error('AUTO PROCESS INTRO VIDEO (addClip) ERROR:', (error as any).message)
        }

        return clip
    }

    async deleteClip(id_clip: number) {
        const clip = await prisma.intro_video_clips.findUnique({ where: { id_clip } })
        if (!clip) throw new Error('Clip no encontrado')

        await prisma.intro_video_clips.delete({ where: { id_clip } })
        await StorageService.deleteRawFile(clip.vc_bucket_path)

        // Reacomoda el orden de los que quedan, sin huecos.
        const remaining = await prisma.intro_video_clips.findMany({
            where: { vc_checkpoint_key: clip.vc_checkpoint_key },
            orderBy: { i_order: 'asc' },
        })
        await prisma.$transaction(
            remaining.map((c, idx) => prisma.intro_video_clips.update({ where: { id_clip: c.id_clip }, data: { i_order: idx } }))
        )

        if (remaining.length > 0) {
            try {
                await this.processCheckpoint(clip.vc_checkpoint_key)
            } catch (error) {
                console.error('AUTO PROCESS INTRO VIDEO (deleteClip) ERROR:', (error as any).message)
            }
        } else {
            // Ya no quedan clips: borra el video procesado anterior si existía.
            await prisma.app_settings.deleteMany({ where: { vc_key: `${SETTING_PREFIX}${clip.vc_checkpoint_key}` } })
        }

        return { deleted: true }
    }

    /**
     * Pega los clips de un checkpoint (en el orden guardado) en un solo
     * video, normalizando resolución/fps/audio primero para que la union no
     * se note. Sube el resultado al bucket y guarda su URL + "firma" (ids de
     * clip en orden) en app_settings, para saber despues si volvio a
     * quedar desactualizada (ver getProcessedSetting / needs_reprocessing).
     */
    async processCheckpoint(checkpointKey: string): Promise<{ url: string }> {
        if (!IntroVideosService.isValidCheckpoint(checkpointKey)) {
            throw new Error('Checkpoint inválido')
        }
        const clips = await prisma.intro_video_clips.findMany({
            where: { vc_checkpoint_key: checkpointKey },
            orderBy: { i_order: 'asc' },
        })
        if (clips.length === 0) throw new Error('No hay videos que unir en este checkpoint')

        const workDir = path.join(os.tmpdir(), `intro-video-${randomUUID()}`)
        await fs.mkdir(workDir, { recursive: true })

        try {
            // 1) Descarga y normaliza cada clip a un .ts intermedio (mismo
            // tamaño/fps/audio), para que el "pegado" no se note ni truene
            // por formatos distintos entre clips.
            const normalizedPaths: string[] = []
            for (let i = 0; i < clips.length; i++) {
                const clip = clips[i]
                const rawPath = path.join(workDir, `raw_${i}.mp4`)
                const tsPath = path.join(workDir, `norm_${i}.ts`)

                const response = await fetch(clip.vc_url)
                if (!response.ok) throw new Error(`No se pudo descargar el clip ${clip.id_clip}`)
                const buffer = Buffer.from(await response.arrayBuffer())
                await fs.writeFile(rawPath, buffer)

                await execFileAsync('ffmpeg', [
                    '-y', '-i', rawPath,
                    '-vf', 'scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1',
                    '-r', '30',
                    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
                    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
                    '-f', 'mpegts',
                    tsPath,
                ])
                normalizedPaths.push(tsPath)
            }

            // 2) Concatena los .ts (mismo formato ya) en un solo mp4 final.
            const joinedPath = path.join(workDir, 'joined.mp4')
            await execFileAsync('ffmpeg', [
                '-y', '-i', `concat:${normalizedPaths.join('|')}`,
                '-c', 'copy', '-bsf:a', 'aac_adtstoasc',
                joinedPath,
            ])

            // 3) Sube el resultado y registra la version procesada.
            const joinedBuffer = await fs.readFile(joinedPath)
            const objectPath = `intro_videos/${checkpointKey}/processed/${Date.now()}.mp4`
            const { url } = await StorageService.uploadRawFile(joinedBuffer, 'video/mp4', objectPath)

            const signature = clips.map(c => c.id_clip).join(',')
            await prisma.app_settings.upsert({
                where: { vc_key: `${SETTING_PREFIX}${checkpointKey}` },
                create: { vc_key: `${SETTING_PREFIX}${checkpointKey}`, vc_value: JSON.stringify({ url, signature, dt_processed: new Date().toISOString() }) },
                update: { vc_value: JSON.stringify({ url, signature, dt_processed: new Date().toISOString() }) },
            })

            return { url }
        } finally {
            await fs.rm(workDir, { recursive: true, force: true })
        }
    }

    async reorderClips(checkpointKey: string, ids: number[]) {
        if (!IntroVideosService.isValidCheckpoint(checkpointKey)) {
            throw new Error('Checkpoint inválido')
        }
        const existing = await prisma.intro_video_clips.findMany({ where: { vc_checkpoint_key: checkpointKey } })
        const existingIds = new Set(existing.map(c => c.id_clip))
        if (ids.length !== existing.length || !ids.every(id => existingIds.has(id))) {
            throw new Error('La lista de ids no coincide con los clips de este checkpoint')
        }

        await prisma.$transaction(
            ids.map((id_clip, idx) => prisma.intro_video_clips.update({ where: { id_clip }, data: { i_order: idx } }))
        )

        try {
            await this.processCheckpoint(checkpointKey)
        } catch (error) {
            console.error('AUTO PROCESS INTRO VIDEO (reorderClips) ERROR:', (error as any).message)
        }

        return { reordered: true }
    }
}
