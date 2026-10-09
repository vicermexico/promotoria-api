export interface CreateRequestDTO {
    id_user: number;
    id_client: number;
    vc_name: string;
    f_value: number;
    url_rack_image?: string;
    /// Extra "Prepedido": si esta activo, el promotor puede levantar un
    /// pedido con el encargado de la tienda cuando falten piezas.
    b_preorder?: boolean;
    /// Solo aplica si b_preorder es true. 'ABIERTA': el encargado elige
    /// fecha/turno de entrega. 'CERRADA': se asigna segun la ruta del cliente.
    preorder_date_mode?: string;
    products?: CreateRequestProductDTO[];
}

export interface UpdateRequestDTO {
    id_user?: number;
    id_client?: number;
    vc_name?: string;
    f_value?: number;
    url_rack_image?: string;
    id_status?: number;
    b_preorder?: boolean;
    preorder_date_mode?: string;
    products?: UpdateRequestProductDTO[];
}

export interface RequestDTO {
    id_request: number;
    id_user: number;
    id_client: number;
    vc_name: string;
    f_value: number;
    url_rack_image?: string;
    id_status: number;
    b_active: boolean;
    b_preorder: boolean;
    dt_register: Date;
    dt_update: Date;
}

export interface CreateRequestProductDTO {
    id_product: number;
    questions?: CreateRequestProductQuestionDTO[];
}

export interface UpdateRequestProductDTO {
    id_request_product?: number;
    id_product: number;
    questions?: UpdateRequestProductQuestionDTO[];
}

export interface RequestProductDTO {
    id_request_product: number;
    id_request: number;
    id_product: number;
    dt_register: Date;
    dt_update: Date;
    b_active: boolean;
}

export interface CreateRequestProductQuestionDTO {
    id_question: number;
}

export interface UpdateRequestProductQuestionDTO {
    id_request_product_question?: number;
    id_question: number;
}

export interface RequestProductQuestionDTO {
    id_request_product_question: number;
    id_request_product: number;
    id_question: number;
    dt_register: Date;
    dt_update: Date;
    b_active: boolean;
}

export interface RequestFiltersDTO {
    id_client?: number;
    id_user?: number;
    id_status?: number;
    b_active?: boolean;
    page?: number;
    limit?: number;
}
