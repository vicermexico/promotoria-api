import { Router } from 'express'
import { authMiddleware, uploadAny } from '../../core/middleware'
import {
    createDriver, listDrivers, listDriversByClient, deactivateDriver, suspendDriver, reactivateDriver, resetDriverPassword, updateDriver, uploadDriverPhoto,
    driverLogin, checkDriverPhone, createStoreByDriver, getDriverProfile, updateDriverPassword, updateDriverLocation,
} from './drivers.controller'

import { getMyAffiliation, getMyReferrals } from '../driver-referrals/driver-referrals.controller'
import { getMyPushKey, registerMyDevice, removeMyDevice, notifyDriverFromPanel } from '../driver-push/driver-push.controller'
import { getMyPayments, getMyBankAccount, saveMyBankAccount } from '../driver-finance/driver-finance.controller'

const driversRouter = Router()

// Login del chofer — publico, es como obtiene su token.
driversRouter.post('/login', driverLogin)
driversRouter.get('/check-phone/:phone', checkDriverPhone)

// Acciones del cliente empresarial sobre sus choferes (alta/baja/edicion).
driversRouter.post('/', authMiddleware, createDriver)
driversRouter.get('/', authMiddleware, listDrivers)
driversRouter.get('/by-client/:id_client', authMiddleware, listDriversByClient)
driversRouter.put('/:id_driver', authMiddleware, updateDriver)
driversRouter.delete('/:id_driver', authMiddleware, deactivateDriver)
driversRouter.patch('/:id_driver/suspend', authMiddleware, suspendDriver)
driversRouter.patch('/:id_driver/reactivate', authMiddleware, reactivateDriver)
driversRouter.patch('/:id_driver/reset-password', authMiddleware, resetDriverPassword)
driversRouter.post('/:id_driver/photo', authMiddleware, uploadAny.single('file'), uploadDriverPhoto)

// El chofer viendo/editando su propia sesion.
driversRouter.get('/me/profile', authMiddleware, getDriverProfile)
driversRouter.patch('/me/password', authMiddleware, updateDriverPassword)
driversRouter.patch('/me/location', authMiddleware, updateDriverLocation)
driversRouter.post('/me/stores', authMiddleware, createStoreByDriver)
// Invitar promotores: su codigo, ganancias y lista de invitados.
driversRouter.get('/me/affiliation', authMiddleware, getMyAffiliation)
driversRouter.get('/me/referrals', authMiddleware, getMyReferrals)
driversRouter.get('/me/payments', authMiddleware, getMyPayments)
driversRouter.get('/me/bank-account', authMiddleware, getMyBankAccount)
driversRouter.post('/me/bank-account', authMiddleware, saveMyBankAccount)
// Notificaciones del chofer: registrar / quitar su celular, y mensaje desde el panel.
driversRouter.get('/me/push-key', authMiddleware, getMyPushKey)
driversRouter.post('/me/devices', authMiddleware, registerMyDevice)
driversRouter.delete('/me/devices', authMiddleware, removeMyDevice)
driversRouter.post('/:id_driver/notify', authMiddleware, notifyDriverFromPanel)

export default driversRouter
