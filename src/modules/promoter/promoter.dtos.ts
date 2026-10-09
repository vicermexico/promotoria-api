export interface PromoterDTO {
    id: number
    name: string
    lastname?: string
    email?: string
    password: string
    phone: string
    fmc_token?: string
    dt_register: string
    dt_updated: string
    dt_last_login?: string
    isActive: boolean
    latitude?: number
    longitude?: number
}

export interface CreatePromoterDTO {
    name: string
    lastname?: string
    email?: string
    password: string
    phone: string
    fcm_token?: string
    latitude?: number
    longitude?: number
    referral_code?: string
    accepted_terms: boolean
}

export interface LoginPromoterDTO {
    termino: string
    password: string
    fcm_token: string
    latitude?: number
    longitude?: number
}

export interface TokenPromoterPayload {
    id: number
    phone: string
    email?: string
}

export type PromoterAccountType = 'CLABE' | 'CARD'

export interface CreatePromoterBankAccountDTO {
    account_holder_name: string
    account_type: PromoterAccountType
    clabe?: string
    card_number?: string
    bank_name: string
}

export interface UpdatePromoterBankAccountDTO {
    account_holder_name?: string
    account_type?: PromoterAccountType
    clabe?: string
    card_number?: string
    bank_name?: string
}

export interface UpdatePromoterProfileDTO {
    name?: string
    lastname?: string
    email?: string
    phone?: string
    b_show_intro_videos?: boolean
    vc_gender?: string
}

export interface UpdatePromoterPasswordDTO {
    current_password: string
    new_password: string
}