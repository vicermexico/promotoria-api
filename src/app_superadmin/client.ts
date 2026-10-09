import db from "../config/database";

import { Utils } from "../core/utils";
import { prisma } from "../core/prisma";
import { Database } from "../core/database";
import { RowDataPacket } from "mysql2/promise";

import { Address } from './address';

interface CreateClientData {
    rfc?: string;
    email?: string;
    phone?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
    adiccional_notes?: string;
    address_details?: create_address_payload;
    vc_initialism?: string;
}

interface create_address_payload {
    id_pais: number;
    id_estado: number;
    id_ciudad: number;
    street: string;
    ext_number: string;
    int_number?: string;
    zip_code?: string;
    neighborhood?: string;
    address_references?: string;
    latitude?: number;
    longitude?: number;
}

interface TotalRow extends RowDataPacket {
  total: number;
}

interface PromoterHeatmapRow extends RowDataPacket {
  id_promoter: number;
  vc_name: string;
  dc_latitude: number;
  dc_longitude: number;
}


export class Client {
    private db: Database = db;

    constructor(){}

    setDb(db: Database) {
        this.db = db;
    }


    async createClient(id_user: number, name: string, data: CreateClientData = {}) {
        let commit = false;
        let addressModel: Address | null = null;

        try {
            if(!this.db.inTransaction){
                await this.db.beginTransaction();
                commit = true;
            }

            const fields = ['id_user', 'name'];
            const values: any[] = [id_user, name];
            const placeholders = ['?', '?'];

            const optionalFields: (keyof CreateClientData)[] = [
                'rfc', 'email', 'phone', 'address', 'city', 'adiccional_notes', 'vc_initialism'
            ];

            for (const field of optionalFields) {
                if (data[field] !== undefined && data[field] !== '') {
                    fields.push(field);
                    values.push(data[field]);
                    placeholders.push('?');
                }
            }

            const query = `INSERT INTO clients (${fields.join(', ')}) VALUES (${placeholders.join(', ')})`;
            const result = await this.db.execute(query, values);
            const clientId = result.insertId;
            // Registrar dirección
            if (data.address_details) {
                addressModel = new Address();
                addressModel.setDb(this.db);
                await addressModel.createAddress({
                    entity_type: 'client',
                    entity_id: clientId,
                    id_country: data.address_details.id_pais,
                    id_state: data.address_details.id_estado,
                    id_city: data.address_details.id_ciudad,
                    street: data.address_details.street,
                    ext_number: data.address_details.ext_number,
                    int_number: data.address_details.int_number,
                    neighborhood: data.address_details.neighborhood,
                    postal_code: data.address_details.zip_code ?? ''
                });
                addressModel = null;
            }

            if(commit){
                await this.db.commit();
            }

            return {
                id: clientId,
                message: "Cliente creado exitosamente"
            };
        } catch (error) {
            console.error("Error en createClient: ", error);
            if (commit) {
                await this.db.rollback();
            }
            throw error;
        } finally {
            addressModel = null;
        }
    }

    async getClients() {
        try {
            const query = `SELECT id_client, name, i_status, dt_register, dt_updated, rfc, email, phone FROM clients WHERE i_status = 1`;
            const clients = await this.db.select(query);
            return clients;
        } catch (error) {
            console.error("Error en getClients: ", error);
            throw error;
        }
    }

    async getClientById(id_client: number) {
        try {
            const query = `SELECT id_client, id_user, name, i_status, dt_register, dt_updated, rfc, email, phone, address, city, adiccional_notes FROM clients WHERE id_client = ?`;
            const clients = await this.db.select(query, [id_client]);
            return clients.length > 0 ? clients[0] : null;
        } catch (error) {
            console.error("Error en getClientById: ", error);
            throw error;
        }
    }

    async getDashboardAnalytics(dateFrom: string, dateTo: string) {
        try {
            const totalClientsResult = await this.db.select<TotalRow[]>(`SELECT COUNT(*) AS total FROM clients`);
            const totalClients = totalClientsResult[0]?.total || 0;

            const totalUsuriosPromotoresResult = await this.db.select<TotalRow[]>(`SELECT COUNT(*) AS total FROM promoters WHERE dt_deleted IS NULL`);
            const totalUsuariosPromotores = totalUsuriosPromotoresResult[0]?.total || 0;

            const totalStoresResult = await this.db.select<TotalRow[]>(`SELECT COUNT(*) AS total FROM stores`);
            const totalStores = totalStoresResult[0]?.total || 0;

            const activeUsersPromotoersResult = await this.db.select<TotalRow[]>(`SELECT COUNT(*) AS total FROM promoters WHERE isActive = 1 AND dt_deleted IS NULL AND dt_last_login BETWEEN ? AND ?`, [dateFrom, dateTo]);
            const activeUsersPromoters = activeUsersPromotoersResult[0]?.total || 0;

            const heatmapPromoters = await this.db.select<PromoterHeatmapRow[]>(
                `SELECT id AS id_promoter, name AS vc_name, latitude AS f_latitude, longitude AS f_longitude
                FROM promoters
                WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND dt_deleted IS NULL
                ORDER BY dt_last_login DESC
                LIMIT 100`
            );

            return {
                totalClients,
                totalUsuariosPromotores,
                totalStores,
                activeUsersPromoters,
                heatmapPromoters,
            };

        } catch (error) {
            console.error("Error en superAdminDashboard: ", error);
            throw error;
        }
    }

    async updateClientFiscalUrl(id_client: number, url: string) {
        try {
            const query = `UPDATE clients SET vc_url_situacion_fiscal = ? WHERE id_client = ?`;
            const result = await this.db.query(query, [url, id_client]);
            return result;
        } catch (error) {
            throw error;
        }
    }

    async deleteClient(id_client: number, id_user: number): Promise<{ ok: boolean; message: string }> {
        try {
            await prisma.$transaction(async (tx) => {

                const promotor = await tx.clients.findUnique({ where: { id_client: id_client }});

                if(!promotor){
                    throw new Error("Cliente no encontrado");
                }

                await tx.clients.update({
                    where: { id_client },
                    data: { i_status: 0 }
                });

                // TODO: obtener el id_usuario para el log
                await tx.client_logs.create({
                    data: {
                        id_client,
                        id_user,
                        log: "Cliente eliminado",
                    }
                });
            });
            return { ok: true, message: "Cliente eliminado correctamente" };
        } catch (error) {
            console.error("Error en deleteClient: ", error);
            throw error;
        }
    }
}