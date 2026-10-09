import { Utils } from "../../core/utils";
import { prisma } from "@/core/prisma";

import { createClientData } from "./client.dto";

export class Client {

    async createClient(clientData: createClientData){
        try{
            return await prisma.$transaction(async (prisma) => {

                const client = await prisma.clients.create({
                    data: {
                        id_user: clientData.id_user,
                        name: clientData.name,
                        vc_initialism: clientData.name.substring(0, 3).toUpperCase(),
                        i_status: 1,
                        rfc: clientData.rfc,
                        email: clientData.email,
                        phone: clientData.phone,
                        adiccional_notes: clientData.addiccional_notes,
                    }
                });

                if (clientData.street || clientData.ext_number || clientData.neighborhood || clientData.zip) {
                    await prisma.addresses.create({
                        data: {
                            entity_type: "client",
                            entity_id: client.id_client,
                            id_country: clientData?.id_pais || 0,
                            id_state: clientData?.id_estado || 0,
                            id_city: clientData?.id_ciudad || 0,
                            street: clientData.street || "",
                            ext_number: clientData.ext_number || "",
                            int_number: clientData.int_number || "",
                            neighborhood: clientData.neighborhood || "",
                            postal_code: clientData.zip || "",
                            is_active: true,
                        }
                    });
                }

                await prisma.user_logs.create({
                    data: {
                        log: `Cliente creado: ${client.name}`,
                        id_user: clientData.id_user
                    }
                });

                const od: any = clientData
                if (od.owner_phone && od.owner_password) {
                    const ya = await prisma.users.findUnique({ where: { email: od.owner_phone }, select: { id_user: true } })
                    if (ya) throw new Error('OWNER_PHONE_EXISTS')
                    await prisma.users.create({
                        data: {
                            email: od.owner_phone,
                            name: od.owner_name || client.name,
                            lastname: od.owner_lastname || '-',
                            password: await Utils.hash_password(od.owner_password),
                            i_rol: 2,
                            i_status: 1,
                            must_change_password: true,
                            id_client: client.id_client,
                            id_user_creator: clientData.id_user,
                        },
                    })
                }
                return client;
            });
        } catch (error) {
            console.error("Error creating client:", error);
            throw error;
        }
    }

    async getClient(id_client: number){
        try {
            return await prisma.clients.findUnique({
                where: {
                    id_client: id_client
                },
            });
        } catch (error) {
            console.error("Error fetching client:", error);
            throw error;
        }
    }

    async getClientsList() {
        const clients = await prisma.clients.findMany({
            where: { i_status: 1 },
        });

        const counts = await prisma.users.groupBy({
            by: ['id_client'],
            _count: { id_user: true },
            where: {
                id_client: { in: clients.map(c => c.id_client) },
            }
        });

        return clients.map(client => ({
            ...client,
            i_cant_usuarios: counts.find(c => c.id_client === client.id_client)?._count.id_user || 0
        }));
    }

    async deleteClient(id_client: number, id_user: number) {
        try {
            return await prisma.$transaction(async (prisma) => {
                const client = await prisma.clients.findUnique({
                    where: { id_client },
                });

                if (!client) {
                    throw new Error("Cliente no encontrado");
                }

                await prisma.clients.update({
                    where: { id_client },
                    data: { i_status: 0 }
                });

                await prisma.user_logs.create({
                    data: {
                        log: `Cliente eliminado: ${client.name}`,
                        id_user: id_user
                    }
                });

                return {
                    ok: true,
                    message: "  Cliente eliminado exitosamente"
                };
            });
        } catch (error) {
            console.error("Error deleting client:", error);
            throw error;
        }
    }


    async updateSituacionFiscal(id_client: number, url: string) {
        return await prisma.clients.update({
            where: { id_client },
            data: { vc_url_situacion_fiscal: url }
        });
    }


    async getAddressByIdClient(id_client: number){
        return await prisma.addresses.findFirst({
            include: {
                country: {
                    select: {
                        id: true,
                        name: true
                    }
                },
                state: {
                    select: {
                        id: true,
                        name: true,
                    }
                },
                city: {
                    select: {
                        id: true,
                        name: true,
                    }
                }
            },
            where: { 
                entity_type:"client",
                entity_id: id_client,
                is_active: true,
            },
        })
    }

}