export const FAQ_GREETING_SETTING_KEY = 'faq_greeting_message'
export const FAQ_GREETING_DEFAULT = '¡Hola! ¿En qué te puedo ayudar?'

export interface FaqPhraseDTO {
    id_faq_question_phrase: number
    vc_phrase: string
}

export interface FaqQuestionDTO {
    id_faq_question: number
    vc_answer_text: string
    phrases: FaqPhraseDTO[]
    dt_register: Date
    dt_updated: Date
}

export interface CreateFaqQuestionDTO {
    vc_answer_text: string
    phrases: string[]
}

export interface UpdateFaqQuestionDTO {
    vc_answer_text?: string
    phrases?: string[]
}

export interface FaqScreenElementDTO {
    id_faq_screen_element: number
    vc_element_key: string
    vc_label: string
    f_x: number
    f_y: number
    f_width: number
    f_height: number
    vc_direction: string | null
    f_rotation_deg: number
}

export interface FaqScreenDTO {
    id_faq_screen: number
    vc_screen_key: string
    vc_title: string
    vc_screenshot_url: string
    vc_app_route: string | null
    elements: FaqScreenElementDTO[]
}

export interface CreateFaqScreenElementDTO {
    vc_label?: string
    f_x: number
    f_y: number
    f_width: number
    f_height: number
    vc_direction?: string
    f_rotation_deg?: number
}

export interface FaqAskStepDTO {
    vc_label: string
    f_x: number
    f_y: number
    f_width: number
    f_height: number
    vc_screenshot_url: string
    vc_app_route: string | null
    vc_direction: string | null
    f_rotation_deg: number
}

export interface FaqAskResponseDTO {
    matched: boolean
    id_faq_question: number | null
    vc_answer_text: string | null
    steps: FaqAskStepDTO[]
}
