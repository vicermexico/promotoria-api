import bcrypt from 'bcrypt'
import { prisma } from '../../core/prisma'
import { EncryptionService } from '../../services/encryption.service'
import { Utils } from '../../core/utils'
import { getPromoterPasswordResetCodeTemplate } from '../../docs/emails/auth'

import {
    CreatePromoterDTO, CreatePromoterBankAccountDTO, UpdatePromoterBankAccountDTO,
    UpdatePromoterProfileDTO, UpdatePromoterPasswordDTO,
} from './promoter.dtos'
export class Promoter {

    async checkPhoneExists(phone: string): Promise<boolean> {
        const promoter = await prisma.promoters.findUnique({
            where: { phone },
            select: { id: true },
        })
        return !!promoter
    }

    async createPromoter(data: CreatePromoterDTO){

        const hashedPassword = await bcrypt.hash(data.password, 10);

        return await prisma.$transaction(async (tx) => {
            // Si capturó un código de referido, buscamos quién lo activó.
            let id_activator: number | null = null
            if (data.referral_code) {
                const activator = await tx.promoters.findUnique({
                    where: { vc_referral_code: data.referral_code }
                })
                if (!activator) throw new Error('El código de referido no es válido')
                id_activator = activator.id
            }

            const promoter = await tx.promoters.create({
                data: {
                    name: data.name,
                    lastname: data.lastname,
                    email: data.email,
                    password: hashedPassword,
                    phone: data.phone,
                    fcm_token: data.fcm_token,
                    latitude: data.latitude,
                    longitude: data.longitude,
                    id_activator,
                    // El schema de validacion exige accepted_terms === true para
                    // llegar hasta aqui; guardamos la fecha real como evidencia
                    // de consentimiento (requisito de privacidad/Google Play).
                    dt_terms_accepted: new Date(),
                    dt_register: new Date().toISOString(),
                    dt_updated: new Date().toISOString()
                }
            })

            // Cada promotor tiene su propio código para poder invitar a otros.
            const updated = await tx.promoters.update({
                where: { id: promoter.id },
                data: { vc_referral_code: `PR${promoter.id}` }
            })

            await tx.promoter_logs.create({
                data: {
                    id_promotor: promoter.id,
                    vc_log: id_activator
                        ? `Promotor ${promoter.name} registrado (activado por el promotor #${id_activator})`
                        : `Promotor ${promoter.name} registrado`,
                }
            })

            const {password, ...promoterWithoutPassword} = updated
            return promoterWithoutPassword
        })
    }

    async getPromoters(){
        const promoters = await prisma.promoters.findMany()
        if (!promoters.length) return []
        const ids = promoters.map(p => p.id)
        const images = await prisma.assets.findMany({
            where: { entity_type: 'promoter', entity_id: { in: ids }, is_active: true },
            select: { entity_id: true, vc_url: true },
        })
        const imageMap = new Map(images.map(img => [img.entity_id, img.vc_url]))
        return promoters.map(p => ({ ...p, vc_profile_image: imageMap.get(p.id) ?? null }))
    }

    async getPromoterById(id: number){
        const promoter = await prisma.promoters.findUnique({ where: { id } })
        if (!promoter) return null
        const asset = await prisma.assets.findFirst({
            where: { entity_type: 'promoter', entity_id: id, is_active: true },
            select: { vc_url: true },
        })
        return { ...promoter, vc_profile_image: asset?.vc_url ?? null }
    }

    async getPromoterByPhone(phone: string){
        return await prisma.promoters.findUnique({
            where: {
                phone
            }
        })
    }

    async ExistPromoterByPhone(phone: string){
        const promoter = await prisma.promoters.findUnique({
            where: {
                phone
            }
        })

        return !!promoter
    }

    async ExistPromoterByEmail(email: string){
        const promoter = await prisma.promoters.findUnique({
            where: {
                email
            }
        })

        return !!promoter
    }

    async updatePromoter(id: number, data: Partial<CreatePromoterDTO>){
        return await prisma.promoters.update({
            where: {
                id
            },
            data: {
                ...data,
                dt_updated: new Date().toISOString()
            }
        })
    }

    async updateProfile(id: number, data: UpdatePromoterProfileDTO) {
        // Validamos unicidad de telefono/correo antes de intentar el update,
        // para devolver un mensaje claro en vez del error crudo de MySQL.
        if (data.phone) {
            const existing = await prisma.promoters.findUnique({ where: { phone: data.phone } })
            if (existing && existing.id !== id) throw new Error('Ese número de celular ya está registrado por otro promotor')
        }
        if (data.email) {
            const existing = await prisma.promoters.findUnique({ where: { email: data.email } })
            if (existing && existing.id !== id) throw new Error('Ese correo ya está registrado por otro promotor')
        }

        const updated = await prisma.promoters.update({
            where: { id },
            data: {
                ...(data.name !== undefined ? { name: data.name } : {}),
                ...(data.lastname !== undefined ? { lastname: data.lastname } : {}),
                ...(data.email !== undefined ? { email: data.email || null } : {}),
                ...(data.phone !== undefined ? { phone: data.phone } : {}),
                ...(data.b_show_intro_videos !== undefined ? { b_show_intro_videos: data.b_show_intro_videos } : {}),
                ...(data.vc_gender !== undefined ? { vc_gender: data.vc_gender } : {}),
                dt_updated: new Date().toISOString(),
            },
        })

        const { password, ...promoterWithoutPassword } = updated
        return promoterWithoutPassword
    }

    async updatePassword(id: number, data: UpdatePromoterPasswordDTO) {
        const promoter = await prisma.promoters.findUnique({ where: { id } })
        if (!promoter) throw new Error('Promotor no encontrado')

        const isValid = await bcrypt.compare(data.current_password, promoter.password)
        if (!isValid) throw new Error('La contraseña actual no es correcta')

        const hashedPassword = await bcrypt.hash(data.new_password, 10)
        await prisma.promoters.update({
            where: { id },
            data: { password: hashedPassword, dt_updated: new Date().toISOString() },
        })

        await prisma.promoter_logs.create({
            data: { id_promotor: id, vc_log: 'Promotor actualizó su contraseña' },
        })
    }

    /**
     * "Olvidé mi contraseña", paso 1: genera un codigo de 6 digitos y lo
     * manda por correo. El login del promotor es por telefono (no siempre
     * tiene correo registrado), asi que si no tiene correo no se puede
     * autoservir — debe pedirle a un admin que se lo restablezca desde el
     * panel (ver adminResetPassword).
     */
    async forgotPassword(phone: string) {
        const promoter = await prisma.promoters.findUnique({ where: { phone } })
        if (!promoter) throw new Error('No se encontró ninguna cuenta con ese número de celular')
        if (!promoter.email) {
            throw new Error(
                'Tu cuenta no tiene un correo registrado, así que no podemos mandarte un código. ' +
                'Pídele a un administrador que te restablezca la contraseña.'
            )
        }

        const code = Math.floor(100000 + Math.random() * 900000).toString()
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000) // 15 minutos

        await prisma.promoters.update({
            where: { id: promoter.id },
            data: { reset_password_code: code, reset_password_expires: expiresAt },
        })

        const emailSent = await Utils.sendEmail(
            promoter.email,
            'Código para restablecer tu contraseña',
            getPromoterPasswordResetCodeTemplate(promoter.name, code),
        )
        if (!emailSent) throw new Error('No se pudo enviar el correo con el código')

        // Enmascaramos el correo en la respuesta (ej. "a***@gmail.com") para
        // no revelar el correo completo a quien solo tenga el telefono.
        const [user, domain] = promoter.email.split('@')
        const maskedEmail = `${user.slice(0, 1)}${'*'.repeat(Math.max(user.length - 1, 1))}@${domain}`
        return { maskedEmail }
    }

    /**
     * "Olvidé mi contraseña", paso 2: valida el codigo (y que no haya
     * expirado) y actualiza la contraseña.
     */
    async resetPasswordWithCode(phone: string, code: string, newPassword: string) {
        const promoter = await prisma.promoters.findUnique({ where: { phone } })
        if (!promoter) throw new Error('No se encontró ninguna cuenta con ese número de celular')

        if (!promoter.reset_password_code || promoter.reset_password_code !== code) {
            throw new Error('El código no es correcto')
        }
        if (!promoter.reset_password_expires || promoter.reset_password_expires < new Date()) {
            throw new Error('El código ya expiró, solicita uno nuevo')
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10)
        await prisma.promoters.update({
            where: { id: promoter.id },
            data: {
                password: hashedPassword,
                reset_password_code: null,
                reset_password_expires: null,
                dt_updated: new Date().toISOString(),
            },
        })

        await prisma.promoter_logs.create({
            data: { id_promotor: promoter.id, vc_log: 'Contraseña restablecida vía código de recuperación' },
        })
    }

    /**
     * Respaldo para Admin/Finanzas desde el panel: genera una contraseña
     * temporal nueva para un promotor (util cuando no tiene correo
     * registrado y no puede autoservirse). El admin debe compartirsela por
     * el medio que tenga (WhatsApp, llamada, etc.) — no queda mas remedio
     * ya que no hay correo a donde mandarla.
     */
    async adminResetPassword(id_promoter: number, id_user_admin: number) {
        const promoter = await prisma.promoters.findUnique({ where: { id: id_promoter } })
        if (!promoter) throw new Error('Promotor no encontrado')

        // Contraseña temporal legible (evita caracteres ambiguos como 0/O, 1/l).
        const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
        const tempPassword = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')

        const hashedPassword = await bcrypt.hash(tempPassword, 10)
        await prisma.promoters.update({
            where: { id: id_promoter },
            data: {
                password: hashedPassword,
                reset_password_code: null,
                reset_password_expires: null,
                dt_updated: new Date().toISOString(),
            },
        })

        await prisma.promoter_logs.create({
            data: { id_promotor: id_promoter, vc_log: 'Un administrador restableció la contraseña de este promotor' },
        })
        await prisma.user_logs.create({
            data: {
                id_user: id_user_admin,
                log: `Restableció la contraseña del promotor #${id_promoter} (${promoter.name}, ${promoter.phone})`,
            },
        })

        return { tempPassword }
    }

    /**
     * Listado de invitados de un promotor (a quienes activó con su código):
     * si están activos, cuánto han generado (lo que se les ha pagado como
     * promotores) y cuánto le ha tocado a él (activador) por cada uno.
     */
    async getReferrals(id_activator: number) {
        const invitees = await prisma.promoters.findMany({
            where: { id_activator },
            select: { id: true, name: true, lastname: true, isActive: true, dt_register: true },
            orderBy: { dt_register: 'desc' },
        })
        if (!invitees.length) return []

        const inviteeIds = invitees.map(p => p.id)

        // Lo que cada invitado ha generado como promotor (total pagado/por pagar
        // a él por sus tareas), uniendo por tarea para mapear a cada invitado.
        const paymentTasks = await prisma.promoter_payment_tasks.findMany({
            where: { task: { id_promoter: { in: inviteeIds } } },
            select: { f_amount: true, task: { select: { id_promoter: true } } },
        })
        const generatedByPromoter = new Map<number, number>()
        for (const pt of paymentTasks) {
            const idPromoter = pt.task.id_promoter
            if (!idPromoter) continue
            generatedByPromoter.set(idPromoter, (generatedByPromoter.get(idPromoter) ?? 0) + Number(pt.f_amount))
        }

        // Lo que le ha tocado a el activador por cada invitado.
        const activatorTasks = await prisma.activator_payment_tasks.findMany({
            where: {
                id_promoter: { in: inviteeIds },
                payment: { id_activator },
            },
            select: { f_amount: true, id_promoter: true },
        })
        const earnedFromInvitee = new Map<number, number>()
        for (const at of activatorTasks) {
            earnedFromInvitee.set(at.id_promoter, (earnedFromInvitee.get(at.id_promoter) ?? 0) + Number(at.f_amount))
        }

        return invitees.map(p => ({
            id: p.id,
            name: `${p.name}${p.lastname ? ' ' + p.lastname : ''}`,
            isActive: p.isActive,
            dt_register: p.dt_register,
            generated: generatedByPromoter.get(p.id) ?? 0,
            earnedForMe: earnedFromInvitee.get(p.id) ?? 0,
        }))
    }

    async updateGeolocation(id: number, latitude: number, longitude: number){
        return await prisma.promoters.update({
            where: {
                id
            },
            data: {
                latitude,
                longitude,
                dt_updated: new Date().toISOString()
            }
        })
    }

    async updateLastLogin(id: number, fcm_token: string){
        return await prisma.promoters.update({
            where: {
                id
            },
            data: {
                fcm_token: fcm_token,
                dt_last_login: new Date().toISOString()
            }
        })
    }

    async updateFcmToken(id: number, fcm_token: string){
        return await prisma.promoters.update({
            where: {
                id
            },
            data: {
                fcm_token
            }
        })
    }

    async deletePromoter(id: number){
        return await prisma.$transaction(async (prisma) => {
            await prisma.promoters.update({
                where: {
                    id
                },
                data: {
                    isActive: false,
                    dt_updated: new Date().toISOString()
                }
            })

            await prisma.promoter_logs.create({
                data: {
                    id_promotor: id,
                    vc_log: `Promotor desactivado`,
                }
            })
        })
    }

    async validatePromoter(email: string, plainPassword: string) {
        const promoter = await prisma.promoters.findUnique({ where: { email } });
        if (!promoter) return null;

        const isValid = await bcrypt.compare(plainPassword, promoter.password);
        if (!isValid) return null;

        return promoter;
    }

    async validatePromoterByTermino(termino: string, plainPassword: string){
        const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(termino)
        const isPhone = /^\+?[\d\s\-().]{7,20}$/.test(termino)

        if(!isEmail && !isPhone) return null

        const field = isEmail ? 'email' : 'phone'

        const promoter = await prisma.promoters.findUnique({
            where: isEmail ? { email: termino } : { phone: termino }
        })
        if (!promoter) return null;

        const isValid = await bcrypt.compare(plainPassword, promoter.password);
        if (!isValid) return null;

        // No dejamos que una cuenta ya eliminada "entre" a medias (login
        // exitoso pero rechazada en la siguiente peticion por
        // authMiddleware) — mejor un mensaje claro desde el login mismo.
        if (promoter.dt_deleted) {
            throw new Error('Esta cuenta fue eliminada. Regístrate de nuevo si quieres volver a usar Promotoria.')
        }

        const asset = await prisma.assets.findFirst({
            where: { entity_type: 'promoter', entity_id: promoter.id, is_active: true },
            select: { vc_url: true },
        })

        return { promoter: { ...promoter, vc_profile_image: asset?.vc_url ?? null }, field };
    }

    async createBankAccount(id_promoter: number, data: CreatePromoterBankAccountDTO) {
        const created = await prisma.promoter_bank_accounts.create({
            data: {
                id_promoter,
                account_holder_name: data.account_holder_name,
                account_type: data.account_type,
                // Nunca se guarda el numero en texto plano; se cifra con AES-256
                // antes de tocar la base de datos.
                clabe: data.account_type === 'CLABE' ? EncryptionService.encrypt(data.clabe) : null,
                card_number: data.account_type === 'CARD' ? EncryptionService.encrypt(data.card_number) : null,
                bank_name: data.bank_name,
            },
        })
        return this.maskBankAccount(created)
    }

    /**
     * Nunca regresa el numero completo: solo los ultimos 4 digitos. Para
     * ver el numero completo hay que usar revealBankAccount, que esta
     * restringido a roles de Admin/Finanzas y queda auditado.
     */
    private maskBankAccount<T extends { clabe: string | null; card_number: string | null }>(account: T) {
        return {
            ...account,
            clabe: account.clabe ? EncryptionService.decryptToMasked(account.clabe) : null,
            card_number: account.card_number ? EncryptionService.decryptToMasked(account.card_number) : null,
        }
    }

    async getBankAccountsByPromoter(id_promoter: number) {
        const accounts = await prisma.promoter_bank_accounts.findMany({
            where: { id_promoter, dt_deleted: null },
            orderBy: { dt_register: 'desc' },
        })
        return accounts.map(a => this.maskBankAccount(a))
    }

    async getBankAccountById(id: number, id_promoter: number) {
        const account = await prisma.promoter_bank_accounts.findFirst({
            where: { id, id_promoter, dt_deleted: null },
        })
        return account ? this.maskBankAccount(account) : null
    }

    async updateBankAccount(id: number, data: UpdatePromoterBankAccountDTO) {
        const updated = await prisma.promoter_bank_accounts.update({
            where: { id },
            data: {
                ...data,
                // Si mandan un numero nuevo, se cifra; si no lo mandan, no se toca.
                ...(data.clabe !== undefined ? { clabe: EncryptionService.encrypt(data.clabe) } : {}),
                ...(data.card_number !== undefined ? { card_number: EncryptionService.encrypt(data.card_number) } : {}),
                ...(data.account_type === 'CLABE' ? { card_number: null } : {}),
                ...(data.account_type === 'CARD' ? { clabe: null } : {}),
                dt_updated: new Date(),
            },
        })
        return this.maskBankAccount(updated)
    }

    /**
     * Regresa el numero COMPLETO, descifrado. Solo debe llamarse desde un
     * endpoint protegido por rol de Admin/Finanzas, y quien la use debe
     * registrar la consulta en la bitacora (ver
     * finances/promoter-payments para el endpoint real).
     */
    async revealBankAccount(id: number) {
        const account = await prisma.promoter_bank_accounts.findFirst({ where: { id, dt_deleted: null } })
        if (!account) return null
        return {
            ...account,
            clabe: EncryptionService.decrypt(account.clabe),
            card_number: EncryptionService.decrypt(account.card_number),
        }
    }

    async softDeleteBankAccount(id: number) {
        return await prisma.promoter_bank_accounts.update({
            where: { id },
            data: { dt_deleted: new Date() },
        })
    }

    /**
     * Borrado hibrido de cuenta (requisito de Google Play):
     * 1. Hard delete: borra FISICAMENTE las cuentas bancarias del promotor
     *    (el dato financiero no debe seguir existiendo en la BD).
     * 2. Soft delete: marca al promotor como eliminado (dt_deleted) e
     *    invalida isActive, PERO conserva su telefono para no romper el
     *    identificador historico ni la integridad contable de tareas/pagos
     *    ya realizados. authMiddleware revisa dt_deleted y rechaza
     *    cualquier token de este promotor de aqui en adelante.
     */
    async deleteAccount(id_promoter: number) {
        const promoter = await prisma.promoters.findUnique({ where: { id: id_promoter }, select: { phone: true } })
        if (!promoter) throw new Error('Promotor no encontrado')

        await prisma.$transaction(async (tx) => {
            await tx.promoter_bank_accounts.deleteMany({ where: { id_promoter } })
            await tx.promoters.update({
                where: { id: id_promoter },
                data: {
                    dt_deleted: new Date(),
                    isActive: false,
                    // La columna phone es VARCHAR(20) (los numeros reales ya
                    // usan casi todo ese espacio), asi que no cabe un
                    // telefono real + un prefijo/sufijo legible. En vez de
                    // eso liberamos el numero con un valor corto y unico
                    // (id + fecha en base36) — el numero original queda
                    // disponible para volver a registrarse, y la identidad
                    // historica se conserva por el id_promoter (no cambia),
                    // que es lo que realmente usan las tareas/pagos ya
                    // asociados a esta cuenta.
                    phone: `del_${id_promoter}_${Date.now().toString(36)}`,
                },
            })
        })
    }

    /**
     * Version del borrado hibrido usada por la pagina publica de
     * eliminacion de cuenta (sin sesion iniciada en la app): pide telefono +
     * contraseña, igual que un login, para evitar que cualquiera borre la
     * cuenta de otra persona con solo saber su numero de celular.
     */
    async deleteAccountByPhone(phone: string, password: string) {
        const promoter = await prisma.promoters.findUnique({ where: { phone } })
        if (!promoter) throw new Error('No se encontró ninguna cuenta con ese número de celular')
        if (promoter.dt_deleted) throw new Error('Esta cuenta ya fue eliminada anteriormente')

        const isValid = await bcrypt.compare(password, promoter.password)
        if (!isValid) throw new Error('La contraseña no es correcta')

        await this.deleteAccount(promoter.id)
    }

    // async updatePromoterImage(id: number, imageUrl: string) {
    //     return await prisma.promoters.update({
    //         where: { id },
    //         data: {
    //             vc_image: imageUrl,
    //             dt_updated: new Date().toISOString()
    //         }
    //     })
    // }

    /**
     * Todos los promotores activos con token de notificaciones, para
     * pedirles que actualicen su ubicacion antes de armar un pedido nuevo
     * (los promotores son globales, no de un cliente en particular -- el
     * sistema de asignacion de tareas ya busca entre todos igual).
     */
    async getActiveWithToken() {
        return await prisma.promoters.findMany({
            where: { isActive: true, fcm_token: { not: null } },
            select: { id: true, fcm_token: true },
        })
    }
}
