import { User } from "../../app_superadmin/user"
import { Utils } from "../../core/utils"
import { ROLES } from "../../core/constants/status.constants"
import { prisma } from "../../core/prisma" 

export class UserAdminDTO extends User {

    async createUser(userData: { email: string, name: string, lastname: string, password: string, i_rol: number, i_status: number, id_client: number, id_user_creator: number }) {
        try {
            return await prisma.users.create({
                data: {
                    email: userData.email,
                    name: userData.name,
                    lastname: userData.lastname,
                    password: await Utils.hash_password(userData.password),
                    i_rol: userData.i_rol,
                    i_status: userData.i_status,
                    id_client: userData.id_client,
                    id_user_creator: userData.id_user_creator,
                }
            })
        } catch (error) {
            throw error;
        }
    }

    async getUserByEmailByClientId(id_client: number, email: string) {
        try {
            return await prisma.users.findUnique({
                where: {
                    email: email,
                    id_client: id_client
                }
            });
        } catch (error) {
            throw error;
        }
    }

    async findByLogin(login: string) {
        return await prisma.users.findUnique({ where: { email: login }, select: { id_user: true } })
    }

    // Usuario del panel del cliente: el celular se guarda en la columna "email",
    // que es la que se usa para hacer login. Siempre rol Administrador de cliente.
    async createClientUser(data: { phone: string, name: string, lastname: string, password: string, id_client: number, id_user_creator: number }) {
        const hashed = await Utils.hash_password(data.password)
        return await prisma.users.create({
            data: {
                email: data.phone,
                name: data.name,
                lastname: data.lastname,
                password: hashed,
                i_rol: ROLES.ADMIN,
                i_status: 1,
                must_change_password: true,
                id_client: data.id_client,
                id_user_creator: data.id_user_creator,
            },
            select: { id_user: true, email: true, name: true, lastname: true, i_rol: true, i_status: true, id_client: true, dt_register: true }
        })
    }

    async getAllUsersByClientId(id_client: number) {
        try {
            return await prisma.users.findMany({
                where: {
                    id_client: id_client,
                    i_status: { in: [0, 1] }
                },
                select: {
                    id_user: true,
                    email: true,
                    name: true,
                    lastname: true,
                    i_rol: true,
                    i_status: true,
                    dt_register: true,
                    dt_updated: true,
                    id_client: true,
                    id_user_creator: true,
                    must_change_password: true,
                }
            });
        } catch (error) {
            throw error;
        }
    }
}