import { Router } from 'express'
import { authMiddleware, requireRole, uploadVideo } from '../../core/middleware'
import { ROLES } from '../../core/constants/status.constants'
import { listIntroVideos, listIntroVideosForPromoter, addIntroVideoClip, deleteIntroVideoClip, reorderIntroVideoClips, processIntroVideoCheckpoint } from './intro-videos.controller'

const introVideosRouter = Router()

// La app del promotor solo puede leer los videos ya unidos (cualquier
// promotor logueado), no administrar clips.
introVideosRouter.get('/promoter', authMiddleware, listIntroVideosForPromoter)

// Solo el master administra los videos de introducción (los 5 checkpoints).
introVideosRouter.get('/', authMiddleware, requireRole(ROLES.SUPER), listIntroVideos)
introVideosRouter.post('/:checkpoint_key/clips', authMiddleware, requireRole(ROLES.SUPER), uploadVideo.single('video'), addIntroVideoClip)
introVideosRouter.delete('/clips/:id_clip', authMiddleware, requireRole(ROLES.SUPER), deleteIntroVideoClip)
introVideosRouter.put('/:checkpoint_key/order', authMiddleware, requireRole(ROLES.SUPER), reorderIntroVideoClips)
introVideosRouter.post('/:checkpoint_key/process', authMiddleware, requireRole(ROLES.SUPER), processIntroVideoCheckpoint)

export default introVideosRouter
