// models/User.ts
import { RowDataPacket } from "mysql2/promise";
import jwt from "jsonwebtoken";
import { Client } from "./client";
import db from "../config/database";
import { TokenPayload, Utils } from "../core/utils";
import { IUser } from "../core/interfaces/user";
import {
  getPasswordChangedTemplate,
  getPasswordResetTemplate,
  getWelcomeUserTemplate
} from "../docs/emails/auth";

export class User {
  private db = db;
  constructor() {}

  // Controller functions
  async createSuperAdmin(
    email: string,
    password: string,
    name: string,
    lastname: string,
  ) {
    let commit = false;
    try {
      if (!this.db.inTransaction) {
        await this.db.beginTransaction();
        commit = true;
      }
      const hased_password = await Utils.hash_password(password);
      const [result]: any = await this.db.query(
        "INSERT INTO users (email, password, i_rol, name, lastname) VALUES (?, ?, 1, ?, ?)",
        [email, hased_password, name, lastname],
      );

      if (commit) {
        await this.db.commit();
      }
      const insert = await this.getUserById(result.insertId);
      return insert;
    } catch (error) {
      if (commit) {
        await this.db.rollback();
      }
      throw error;
    }
  }

  async loginSuperAdmin(email: string, password: string) {
    try {
      const user = await this.getUserByEmail(email);
      const isValidPassword = await Utils.compare_password(password, user.password);
      if (!isValidPassword) {
        throw new Error("Contraseña incorrecta");
      }

      const estadoCuenta = (user as any).i_status;
      if (estadoCuenta === 0 || estadoCuenta === 2) {
        throw new Error("CUENTA_SUSPENDIDA");
      }

      const tokenPayload: TokenPayload = {
        id: user.id_user!,
        email: user.email,
        id_client: user.id_client!,
        i_rol: user.i_rol
      };
      const token = Utils.generate_token(tokenPayload);

      // await Utils.registerUserLog(
      //   this.db,
      //   user.id_user!,
      //   "Usuario inició sesión"
      // );

      const { password: _, ...userWithoutPassword } = user;

      return {
        user: userWithoutPassword,
        token,
      };
    } catch (error) {
      throw error;
    }
  }

  async restorePassword(email: string) {
    try {
      const user = await this.getUserByEmail(email);

      if (!user) {
        throw new Error("Usuario no encontrado");
      }

      const token = Utils.generate_token({
        id: user.id_user!,
        email: user.email,
        id_client: user.id_client!,
        i_rol: user.i_rol
      });


      const expiresAt = new Date(Date.now() + 3600000);

      await this.updateResetToken(user.id_user!, token, expiresAt);

      // Crear link de recuperación
      const resetLink = `${process.env.FRONTEND_URL}/restore-pwd?token=${token}`;

      const emailSent = await Utils.sendEmail(
        user.email,
        "Recuperación de Contraseña",
        getPasswordResetTemplate(user.name, resetLink, token),
      );

      if (!emailSent) {
        throw new Error("Error al enviar el correo de recuperación");
      }

      return {
        message: "Correo de recuperación enviado exitosamente",
      };
    } catch (error) {
      throw error;
    }
  }

  // Auxiliar functions
  async getUserById(id: number): Promise<IUser> {
    try {
      const [result]: any[] = await this.db.query(
        "SELECT id_user, email, i_rol, dt_register, dt_updated, name, lastname FROM users WHERE id_user = ? LIMIT 1",
        [id],
      );
      const user_finded = result[0];
      if (!user_finded) {
        throw new Error("Usuario no encontrado");
      }
      return user_finded;
    } catch (error) {
      throw error;
    }
  }

  async getUserByEmail(email: string): Promise<IUser> {
    try {
      const [result]: any[] = await this.db.query(
        "SELECT id_user, email, password, i_rol, i_status, dt_register, dt_updated, name, lastname, id_client, must_change_password, vc_permisos FROM users WHERE email = ? LIMIT 1",
        [email],
      );
      const user_finded = result[0];
      if (!user_finded) {
        throw new Error("Usuario no encontrado");
      }
      return user_finded;
    } catch (error) {
      throw error;
    }
  }

  // Método para actualizar el token de reset en la BD
  async updateResetToken(userId: number, token: string, expiresAt: Date) {
    try {
      const query = `UPDATE users SET reset_password_token = ?, reset_password_expires = ? WHERE id_user = ?`;
      await this.db.query(query, [token, expiresAt, userId]);
    } catch (error) {
      throw error;
    }
  }

  async resetPasswordWithToken(token: string, newPassword: string) {
    try {
      const user_data = await this.getUserByResetToken(token);

      if (!user_data) {
        throw new Error("Token inválido o expirado");
      }

      if (user_data.reset_password_token !== token || new Date(user_data.reset_password_expires!) < new Date()) {
        throw new Error("El token ha expirado");
      }

      const hashedPassword = await Utils.hash_password(newPassword);

      await this.updatePassword(user_data.id_user, hashedPassword);

      await Utils.sendEmail(
        user_data.email,
        "Contraseña Actualizada",
        getPasswordChangedTemplate(user_data.name),
      );

      // TODO actualizar esto despues
      // await Utils.registerUserLog(
      //   this.db,
      //   user_data.id_user,
      //   "Contraseña restablecida exitosamente"
      // );

      return {
        message: "Contraseña actualizada exitosamente",
      };
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        throw new Error("Token inválido");
      }
      if (error instanceof jwt.TokenExpiredError) {
        throw new Error("El token ha expirado");
      }
      throw error;
    }
  }

  async getUserByResetToken(token: string): Promise<IUser | null> {
    try {
      const query = `
        SELECT * FROM users
        WHERE reset_password_token = ?
      `;

      const rows = await this.db.select<RowDataPacket[]>(query, [token]);
      return (rows[0] as IUser) || null;
    } catch (error) {
      throw new Error("Error al buscar usuario por token");
    }
  }

  async changePassword(userId: number, currentPassword: string, newPassword: string) {
    try {
      const [result]: any[] = await this.db.query(
        "SELECT id_user, email, password, name FROM users WHERE id_user = ? LIMIT 1",
        [userId],
      );
      const user = result[0];
      if (!user) {
        throw new Error("Usuario no encontrado");
      }

      const isValid = await Utils.compare_password(currentPassword, user.password);
      if (!isValid) {
        throw new Error("Contraseña actual incorrecta");
      }

      const hashedPassword = await Utils.hash_password(newPassword);
      await this.updatePassword(userId, hashedPassword);

      await Utils.sendEmail(
        user.email,
        "Contraseña Actualizada",
        getPasswordChangedTemplate(user.name),
      );

      return { message: "Contraseña actualizada exitosamente" };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Cambio obligatorio de contraseña (primer acceso o reseteo): no pide la
   * contraseña actual, pero SOLO funciona si la cuenta está marcada con
   * must_change_password = 1.
   */
  async forceChangePassword(userId: number, newPassword: string) {
    const [result]: any[] = await this.db.query(
      "SELECT id_user, must_change_password FROM users WHERE id_user = ? LIMIT 1",
      [userId],
    );
    const user = result[0];
    if (!user) {
      throw new Error("Usuario no encontrado");
    }
    if (!user.must_change_password) {
      throw new Error("NO_REQUIERE_CAMBIO");
    }
    const hashedPassword = await Utils.hash_password(newPassword);
    await this.updatePassword(userId, hashedPassword);
    return { message: "Contraseña actualizada exitosamente" };
  }

  async updatePassword(userId: number, hashedPassword: string) {
    const query = `
      UPDATE users
      SET password = ?,
          must_change_password = 0,
          reset_password_token = NULL,
          reset_password_expires = NULL
      WHERE id_user = ?
    `;
    await this.db.query(query, [hashedPassword, userId]);
  }

  /**
   * Solo el master la usa: resetea la contraseña de un usuario a "1234" y
   * marca must_change_password para que en su siguiente login se le pida
   * poner una nueva antes de dejarlo usar el resto del sistema.
   */
  async resetPasswordToDefault(userId: number) {
    const hashedPassword = await Utils.hash_password("1234");
    const query = `
      UPDATE users
      SET password = ?,
          must_change_password = 1,
          reset_password_token = NULL,
          reset_password_expires = NULL
      WHERE id_user = ?
    `;
    await this.db.query(query, [hashedPassword, userId]);
  }

  async createUserInClient(name: string, lastname: string, email: string, id_client: number, id_user_creator: number) {
    try {

      const existingUser = await this.db.select<RowDataPacket[]>(
        "SELECT id_user FROM users WHERE email = ?",
        [email]
      );

      if (existingUser.length > 0) {
        throw new Error("El correo electrónico ya está registrado");
      }

      let commit = false;

      if (!this.db.inTransaction) {
        await this.db.beginTransaction();
        commit = true;
      }

      const query = `
        INSERT INTO users (name, lastname, email, id_client, id_user_creator, password)
        VALUES (?, ?, ?, ?, ?, "")
      `;
      await this.db.query(query, [name, lastname, email, id_client, id_user_creator]);

      if (commit) {
        await this.db.commit();
      }

      const userId = (await this.db.select<RowDataPacket[]>("SELECT LAST_INSERT_ID() AS id"))[0].id;

      // Obtener datos del usuario y cliente
      const user = await this.getUserById(userId);
      const client = await new Client().getClientById(id_client);

      // Generar token para configurar contraseña (reutiliza tu lógica de reset)
      const token = Utils.generate_token({
        id: user.id_user!,
        email: user.email,
        id_client: user.id_client!,
        i_rol: user.i_rol
      });
      const expiresAt = new Date(Date.now() + 3600000);
      await this.updateResetToken(user.id_user!, token, expiresAt);
      const setupPasswordLink = `${process.env.FRONTEND_URL}/restore-pwd?token=${token}`;

      // Enviar email de bienvenida
      await Utils.sendEmail(
        email,
        `Bienvenido a RetaiLink - ${client!.name}`,
        getWelcomeUserTemplate(
          `${user.name} ${user.lastname}`,
          client!.name,
          email,
          setupPasswordLink
        ),
      );

      return user;
    } catch (error) {
      throw error;
    }
  }

  async getUsersByClient(id_client: number): Promise<IUser[]> {
    try {
      const [result]: any[] = await this.db.query(
        "SELECT id_user, email, name, lastname, i_rol, i_status, dt_register, dt_updated FROM users WHERE id_client = ? ORDER BY name ASC",
        [id_client]
      );
      return result;
    } catch (error) {
      throw error;
    }
  }

  async updateUserEmail(userId: number, email: string) {
    try {
      const existing = await this.db.select<RowDataPacket[]>(
        "SELECT id_user FROM users WHERE email = ? AND id_user != ?",
        [email, userId]
      );
      if (existing.length > 0) {
        throw new Error("El correo electrónico ya está en uso");
      }
      await this.db.query("UPDATE users SET email = ? WHERE id_user = ?", [email, userId]);
      return await this.getUserById(userId);
    } catch (error) {
      throw error;
    }
  }

  async updateUserProfile(userId: number, name: string, lastname: string) {
    try {
      await this.db.query(
        "UPDATE users SET name = ?, lastname = ? WHERE id_user = ?",
        [name, lastname, userId]
      );
      return await this.getUserById(userId);
    } catch (error) {
      throw error;
    }
  }

  async updateUserRol(userId: number, i_rol: number) {
    try {
      await this.db.query("UPDATE users SET i_rol = ? WHERE id_user = ?", [i_rol, userId]);
      return await this.getUserById(userId);
    } catch (error) {
      throw error;
    }
  }

  async resetUserPassword(userId: number, newPassword: string) {
    try {
      const user = await this.getUserById(userId);
      const hashedPassword = await Utils.hash_password(newPassword);
      await this.updatePassword(userId, hashedPassword);
      await Utils.sendEmail(
        user.email,
        "Contraseña Actualizada",
        getPasswordChangedTemplate(user.name),
      );
      return { message: "Contraseña restablecida exitosamente" };
    } catch (error) {
      throw error;
    }
  }

  async deactivateUser(userId: number) {
    try {
      await this.db.query("UPDATE users SET i_status = 0 WHERE id_user = ?", [userId]);
      return { message: "Usuario desactivado exitosamente" };
    } catch (error) {
      throw error;
    }
  }

  async activateUser(userId: number) {
    try {
      await this.db.query("UPDATE users SET i_status = 1 WHERE id_user = ?", [userId]);
      return { message: "Usuario activado exitosamente" };
    } catch (error) {
      throw error;
    }
  }

  async getCountriesList(){
    try {
      const query = `SELECT id, name FROM countries WHERE is_active = 1 ORDER BY name ASC`;
      const rows = await this.db.select<RowDataPacket[]>(query);
      return rows;
    } catch (error) {
      throw error;
    }
  }

  async getCountryById(id_country: number){
    try {
      const query = `SELECT id, name FROM countries WHERE id = ? AND is_active = 1 LIMIT 1`;
      const rows = await this.db.select<RowDataPacket[]>(query
        , [id_country]);
      return rows.length > 0 ? rows[0] : null;
    }
    catch (error) {
      throw error;
    }
  }


  async getStatesList(id_country: number){
    try {
        const query = `SELECT id, name FROM states WHERE id_country = ? AND is_active = 1 ORDER BY name ASC`;
        const rows = await this.db.select<RowDataPacket[]>(query, [id_country]);
        return rows;
    } catch (error) {
        throw error;
    }
  }

  async getStateById(id_state: number){
    try {
        const query = `SELECT id, id_country, name FROM states WHERE id = ? AND is_active = 1 LIMIT 1`; 
        const rows = await this.db.select<RowDataPacket[]>(query
        , [id_state]);
        return rows.length > 0 ? rows[0] : null;
    } catch (error) {
        throw error;
    }
  }


  async getCitiesList(id_country: number, id_state: number){
    try {
        const query = `SELECT id, name FROM cities WHERE id_country = ? AND id_state = ? AND is_active = 1 ORDER BY name ASC`;
        const rows = await this.db.select<RowDataPacket[]>(query, [id_country, id_state]);
        return rows;
    } catch (error) {
        throw error;
    }
  }

  async getCityById(id_city: number){
    try {
        const query = `SELECT id, id_country, id_state, name FROM cities WHERE id = ? AND is_active = 1 LIMIT 1`; 
        const rows = await this.db.select<RowDataPacket[]>(query
        , [id_city]);
        return rows.length > 0 ? rows[0] : null;
    } catch (error) {
        throw error;
    }
  }
}
