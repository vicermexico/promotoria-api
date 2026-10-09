import { prisma } from '../../core/prisma'
import { Prisma } from '../../generated/prisma/client'
import {
    CreateRequestDTO,
    UpdateRequestDTO,
    RequestFiltersDTO,
} from './requests.dtos'
import { generateFolio } from '../../services/folio.service'
import { resolveImages } from '../../core/asset-resolver'
import { TaskSettings } from '../task-settings/task-settings.service'

export class Request {

    private taskSettings = new TaskSettings()


    /**
     * La pregunta "¿Cuántas piezas hay en existencia?" es de sistema: gratis,
     * numérica, y se agrega sola a todo producto de toda solicitud (el cliente
     * no la configura). Solo existe una en toda la plataforma; si no existe
     * aún, se crea la primera vez que se necesita.
     */
    private async getOrCreateStockQuestion(tx: Prisma.TransactionClient, id_user: number): Promise<number> {
        const existing = await tx.questions.findFirst({
            where: { b_stock_question: true },
            select: { id_question: true },
        })
        if (existing) return existing.id_question

        const created = await tx.questions.create({
            data: {
                id_user,
                question: '¿Cuántas piezas hay en existencia?',
                question_type: 'numeric',
                f_cost: 0,
                b_stock_question: true,
            },
            select: { id_question: true },
        })
        return created.id_question
    }

    /**
     * Calcula el costo real de la solicitud en el backend (nunca se confía en lo
     * que mande el navegador, porque es dinero real que después se factura).
     *
     * Regla de negocio:
     * - Costo base según cantidad de PRODUCTOS: hasta 3 productos = $45.
     *   Cada producto extra (4to, 5to, 6to) suma $15, con tope de $90 total
     *   (a partir del 7mo producto en adelante ya no sube el costo base).
     * - Cada PREGUNTA seleccionada suma su propio costo (questions.f_cost),
     *   el cual asigna el Master al crear la pregunta (puede ser $0 = gratis).
     *   No tiene tope, se suma completo.
     */
    private async calculateRequestCost(
        tx: Prisma.TransactionClient,
        products: { id_product: number, questions?: { id_question: number }[] }[],
        b_preorder?: boolean,
    ): Promise<number> {
        const numProductos = products.length
        const base = numProductos <= 3 ? 45 : Math.min(45 + (Math.min(numProductos - 3, 3) * 15), 90)

        const questionIds = [...new Set(
            products.flatMap(p => (p.questions ?? []).map(q => q.id_question))
        )]

        let costoPreguntas = 0
        if (questionIds.length > 0) {
            const questions = await tx.questions.findMany({
                where: { id_question: { in: questionIds } },
                select: { id_question: true, f_cost: true }
            })
            const costMap = new Map(questions.map(q => [q.id_question, Number(q.f_cost)]))

            for (const product of products) {
                for (const q of product.questions ?? []) {
                    costoPreguntas += costMap.get(q.id_question) ?? 0
                }
            }
        }

        const subtotal = base + costoPreguntas

        // Extra "Prepedido": el promotor hace trabajo extra (negociar con el
        // encargado, capturar firma), asi que se cobra un cargo adicional
        // configurable por el master (monto fijo o porcentaje).
        let costoPrepedido = 0
        if (b_preorder) {
            costoPrepedido = await this.taskSettings.calculatePreorderSurcharge(subtotal)
        }

        return subtotal + costoPrepedido
    }

    async createRequest(data: CreateRequestDTO) {
        return await prisma.$transaction(async (tx) => {
            const vc_folio = await generateFolio(tx, data.id_client, 'requests')
            const f_value = await this.calculateRequestCost(tx, data.products ?? [], data.b_preorder)

            const request = await tx.requests.create({
                data: {
                    id_user: data.id_user,
                    id_client: data.id_client,
                    vc_folio,
                    vc_name: data.vc_name,
                    f_value,
                    url_rack_image: data.url_rack_image,
                    b_preorder: data.b_preorder ?? false,
                    preorder_date_mode: data.preorder_date_mode ?? 'ABIERTA',
                }
            })

            if (data.products && data.products.length > 0) {
                const stockQuestionId = await this.getOrCreateStockQuestion(tx, data.id_user)

                for (const product of data.products) {
                    const requestProduct = await tx.request_products.create({
                        data: {
                            id_request: request.id_request,
                            id_product: product.id_product,
                        }
                    })

                    if (product.questions && product.questions.length > 0) {
                        for (const question of product.questions) {
                            await tx.request_product_questions.create({
                                data: {
                                    id_request_product: requestProduct.id_request_product,
                                    id_question: question.id_question
                                }
                            })
                        }
                    }

                    // La pregunta de piezas siempre va, la haya elegido el
                    // cliente o no (y es gratis, no afecta el costo).
                    await tx.request_product_questions.create({
                        data: {
                            id_request_product: requestProduct.id_request_product,
                            id_question: stockQuestionId,
                        }
                    })
                }
            }

            return request
        })
    }

    async getAllRequests(filters: RequestFiltersDTO) {
        const page = filters.page ?? 1
        const limit = filters.limit ?? 20
        const skip = (page - 1) * limit

        const where: any = {}
        if (filters.id_client !== undefined) where.id_client = filters.id_client
        if (filters.id_user !== undefined) where.id_user = filters.id_user
        if (filters.id_status !== undefined) where.id_status = filters.id_status
        if (filters.b_active !== undefined) where.b_active = filters.b_active
        else where.b_active = true

        const [requests, total] = await Promise.all([
            prisma.requests.findMany({
                where,
                skip,
                take: limit,
                orderBy: { dt_register: 'desc' },
                include: {
                    request_products: {
                        where: { b_active: true },
                        include: {
                            product: {
                                select: {
                                    id_product: true,
                                    vc_folio: true,
                                    name: true,
                                    vc_image: true,
                                }
                            },
                            request_product_questions: {
                                where: { b_active: true },
                                include: {
                                    question: {
                                        select: {
                                            id_question: true,
                                            question: true,
                                            question_type: true,
                                            f_cost: true,
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }),
            prisma.requests.count({ where })
        ])

        const requestIds = requests.map(r => r.id_request);
        const productIds = [...new Set(requests.flatMap(r => r.request_products.map(rp => rp.product.id_product)))];
        const [requestAssets, productAssets] = await Promise.all([
            resolveImages('request', requestIds),
            resolveImages('product', productIds),
        ]);

        const data = requests.map(r => ({
            ...r,
            url_rack_image: requestAssets.get(r.id_request) ?? r.url_rack_image,
            request_products: r.request_products.map(rp => ({
                ...rp,
                product: { ...rp.product, vc_image: productAssets.get(rp.product.id_product) ?? rp.product.vc_image },
            })),
        }));

        return {
            data,
            meta: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            }
        }
    }

    async getRequestById(id_request: number) {
        const request = await prisma.requests.findUnique({
            where: { id_request },
            include: {
                request_products: {
                    where: { b_active: true },
                    include: {
                        product: {
                            select: {
                                id_product: true,
                                vc_folio: true,
                                name: true,
                                vc_image: true,
                            }
                        },
                        request_product_questions: {
                            where: { b_active: true },
                            include: {
                                question: {
                                    select: {
                                        id_question: true,
                                        question: true,
                                        question_type: true,
                                        f_cost: true,
                                    }
                                }
                            }
                        }
                    }
                }
            }
        })
        if (!request) return null;

        const productIds = request.request_products.map(rp => rp.product.id_product);
        const [requestAssets, productAssets] = await Promise.all([
            resolveImages('request', [id_request]),
            resolveImages('product', productIds),
        ]);

        return {
            ...request,
            url_rack_image: requestAssets.get(id_request) ?? request.url_rack_image,
            request_products: request.request_products.map(rp => ({
                ...rp,
                product: { ...rp.product, vc_image: productAssets.get(rp.product.id_product) ?? rp.product.vc_image },
            })),
        };
    }

    async updateRequest(id_request: number, data: UpdateRequestDTO) {
        return await prisma.$transaction(async (tx) => {
            // Solo recalculamos el costo si vienen productos en el payload (es la
            // única forma de saber el estado completo y correcto a cobrar). Si no
            // vienen productos, el f_value existente se deja tal cual, nunca se
            // confía en un f_value suelto que mande el navegador.
            let f_value: number | undefined
            if (data.products) {
                // Si no mandan b_preorder explicito en este update, usamos el
                // valor que ya tenia la solicitud, para no perder el cargo
                // extra al recalcular el precio por otra razon.
                let effectivePreorder = data.b_preorder
                if (effectivePreorder === undefined) {
                    const current = await tx.requests.findUnique({ where: { id_request }, select: { b_preorder: true } })
                    effectivePreorder = current?.b_preorder ?? false
                }
                f_value = await this.calculateRequestCost(tx, data.products, effectivePreorder)
            }

            const request = await tx.requests.update({
                where: { id_request },
                data: {
                    id_user: data.id_user,
                    id_client: data.id_client,
                    vc_name: data.vc_name,
                    f_value,
                    url_rack_image: data.url_rack_image,
                    id_status: data.id_status,
                    b_preorder: data.b_preorder,
                    preorder_date_mode: data.preorder_date_mode,
                    dt_update: new Date(),
                }
            })

            if (data.products) {
                const existingProducts = await tx.request_products.findMany({
                    where: { id_request, b_active: true }
                })

                const incomingProductIds = data.products
                    .filter(p => p.id_request_product)
                    .map(p => p.id_request_product!)

                const productsToDeactivate = existingProducts.filter(
                    ep => !incomingProductIds.includes(ep.id_request_product)
                )

                for (const prod of productsToDeactivate) {
                    await tx.request_products.update({
                        where: { id_request_product: prod.id_request_product },
                        data: { b_active: false, dt_update: new Date() }
                    })

                    await tx.request_product_questions.updateMany({
                        where: { id_request_product: prod.id_request_product },
                        data: { b_active: false, dt_update: new Date() }
                    })
                }

                for (const product of data.products) {
                    let requestProductId: number

                    if (product.id_request_product) {
                        const existing = existingProducts.find(
                            ep => ep.id_request_product === product.id_request_product
                        )

                        if (existing) {
                            await tx.request_products.update({
                                where: { id_request_product: existing.id_request_product },
                                data: {
                                    id_product: product.id_product,
                                    dt_update: new Date()
                                }
                            })
                            requestProductId = existing.id_request_product
                        } else {
                            const created = await tx.request_products.create({
                                data: {
                                    id_request,
                                    id_product: product.id_product,
                                }
                            })
                            requestProductId = created.id_request_product
                        }
                    } else {
                        const existingAny = await tx.request_products.findFirst({
                            where: { id_request, id_product: product.id_product }
                        })

                        if (existingAny) {
                            await tx.request_products.update({
                                where: { id_request_product: existingAny.id_request_product },
                                data: { b_active: true, dt_update: new Date() }
                            })
                            requestProductId = existingAny.id_request_product
                        } else {
                            const created = await tx.request_products.create({
                                data: {
                                    id_request,
                                    id_product: product.id_product,
                                }
                            })
                            requestProductId = created.id_request_product
                        }
                    }

                    if (product.questions) {
                        const existingQuestions = await tx.request_product_questions.findMany({
                            where: { id_request_product: requestProductId, b_active: true },
                            include: { question: { select: { b_stock_question: true } } },
                        })

                        const incomingQuestionIds = product.questions
                            .filter(q => q.id_request_product_question)
                            .map(q => q.id_request_product_question!)

                        // La pregunta de piezas nunca se desactiva desde aqui,
                        // aunque el cliente no la mande en su lista (el cliente
                        // no la ve ni la controla; es de sistema).
                        const questionsToDeactivate = existingQuestions.filter(
                            eq => !eq.question.b_stock_question && !incomingQuestionIds.includes(eq.id_request_product_question)
                        )

                        for (const q of questionsToDeactivate) {
                            await tx.request_product_questions.update({
                                where: { id_request_product_question: q.id_request_product_question },
                                data: { b_active: false, dt_update: new Date() }
                            })
                        }

                        for (const question of product.questions) {
                            if (question.id_request_product_question) {
                                const existingQ = existingQuestions.find(
                                    eq => eq.id_request_product_question === question.id_request_product_question
                                )
                                if (existingQ) {
                                    await tx.request_product_questions.update({
                                        where: { id_request_product_question: existingQ.id_request_product_question },
                                        data: {
                                            id_question: question.id_question,
                                            dt_update: new Date()
                                        }
                                    })
                                    continue
                                }
                            }

                            const existingQAny = await tx.request_product_questions.findFirst({
                                where: { id_request_product: requestProductId, id_question: question.id_question }
                            })

                            if (existingQAny) {
                                await tx.request_product_questions.update({
                                    where: { id_request_product_question: existingQAny.id_request_product_question },
                                    data: { b_active: true, dt_update: new Date() }
                                })
                            } else {
                                await tx.request_product_questions.create({
                                    data: {
                                        id_request_product: requestProductId,
                                        id_question: question.id_question,
                                    }
                                })
                            }
                        }
                    }

                    // Garantiza que la pregunta de piezas siempre quede activa
                    // en este producto, la haya mandado el cliente o no.
                    const stockQuestionId = await this.getOrCreateStockQuestion(tx, data.id_user ?? request.id_user)
                    const existingStockQuestion = await tx.request_product_questions.findFirst({
                        where: { id_request_product: requestProductId, id_question: stockQuestionId }
                    })
                    if (existingStockQuestion) {
                        if (!existingStockQuestion.b_active) {
                            await tx.request_product_questions.update({
                                where: { id_request_product_question: existingStockQuestion.id_request_product_question },
                                data: { b_active: true, dt_update: new Date() }
                            })
                        }
                    } else {
                        await tx.request_product_questions.create({
                            data: { id_request_product: requestProductId, id_question: stockQuestionId }
                        })
                    }
                }
            }

            return request
        })
    }

    async deleteRequest(id_request: number) {
        return await prisma.$transaction(async (tx) => {
            await tx.requests.update({
                where: { id_request },
                data: { b_active: false, dt_update: new Date() }
            })

            const products = await tx.request_products.findMany({
                where: { id_request, b_active: true }
            })

            for (const product of products) {
                await tx.request_products.update({
                    where: { id_request_product: product.id_request_product },
                    data: { b_active: false, dt_update: new Date() }
                })

                await tx.request_product_questions.updateMany({
                    where: { id_request_product: product.id_request_product },
                    data: { b_active: false, dt_update: new Date() }
                })
            }

            return { id_request, deleted: true }
        })
    }

    /**
     * Cuando el master cambia el costo por producto / minimo / maximo en
     * Configurar App, recalcula el precio de TODAS las solicitudes ya
     * guardadas (usando la cantidad de productos que tenga cada una hoy)
     * para que queden al dia con la nueva configuracion. Esto NO toca los
     * pedidos que ya estan en curso -- ahi el precio ya quedo congelado en
     * order_items.f_value al momento de crear el pedido, es un dato aparte.
     */
    async recalculateAllPrices(pricing: { price_per_product: number; min_products: number; max_products: number }) {
        const requests = await prisma.requests.findMany({
            where: { b_active: true },
            include: {
                request_products: {
                    where: { b_active: true },
                    include: {
                        request_product_questions: {
                            where: { b_active: true },
                            include: { question: { select: { f_cost: true } } },
                        },
                    },
                },
            },
        })

        let updated = 0
        for (const req of requests) {
            const numProductos = req.request_products.length
            const productosFacturables = Math.min(Math.max(numProductos, pricing.min_products), pricing.max_products)
            const costoBase = productosFacturables * pricing.price_per_product
            let costoPreguntas = 0
            for (const rp of req.request_products) {
                for (const rpq of rp.request_product_questions) {
                    costoPreguntas += Number(rpq.question.f_cost)
                }
            }
            const newValue = costoBase + costoPreguntas
            if (Number(req.f_value) !== newValue) {
                await prisma.requests.update({ where: { id_request: req.id_request }, data: { f_value: newValue } })
                updated++
            }
        }
        return { total: requests.length, updated }
    }
}
