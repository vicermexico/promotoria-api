import { Request, Response } from 'express'

import { UserAdminDTO } from "./user.service"
import { LogsDTO } from "../logs/logs.dto"
import { Utils } from '../../core/utils'

const userAdminDTO = new UserAdminDTO();
const logsDTO = new LogsDTO();

export const getAllUsersByClientId = async (req: Request, res: Response) => {
    const { id_client } = req.params;

    try {
        const users = await userAdminDTO.getAllUsersByClientId(Number(id_client));
        res.json({
            ok: true,
            error: 0,
            data: users,
            message: 'Usuarios obtenidos exitosamente'
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            ok: false,
            error: 1,
            data: null,
            message: 'Error al obtener los usuarios'
        });
    }
}

export const createUser =  async (req: Request, res: Response) => {
  const id_user = req.user?.id;

  const { email, name, lastname, password, i_rol, i_status, id_client } = req.body;

  try {

    const getUserByEmail = await userAdminDTO.getUserByEmailByClientId(Number(id_client), email);

    if (getUserByEmail) {
      return res.status(400).json({
        ok: false,
        error: 1,
        data: null,
        message: 'El correo electrónico ya está registrado para este cliente'
      });
    }

    const newUser = await userAdminDTO.createUser({
      email,
      name,
      lastname,
      password,
      i_rol,
      i_status,
      id_client: Number(id_client),
      id_user_creator: Number(id_user)
    });

    await logsDTO.createUserLog(`Usuario ${email} creado`, Number(id_user));

    res.status(201).json({
      ok: true,
      error: 0,
      data: newUser,
      message: 'Usuario creado exitosamente'
    });
    
  } catch (error) {
    console.error(error);
    res.status(500).json({
      ok: false,
      error: 1,
      data: null,
      message: 'Error al crear el usuario'
    });
  }

}

export const createClientUser = async (req: Request, res: Response) => {
  try {
    const { name, lastname, phone, password } = req.body;
    // Siempre dentro del negocio de quien lo crea: jamás se toma de lo que mande el navegador.
    const id_client = Number(req.user!.id_client);
    const id_user = Number(req.user!.id);

    const existing = await userAdminDTO.findByLogin(phone);
    if (existing) {
      return res.status(400).json({
        ok: false,
        error: 1,
        data: null,
        message: 'Ese número de celular ya está registrado'
      });
    }

    const newUser = await userAdminDTO.createClientUser({ phone, name, lastname, password, id_client, id_user_creator: id_user });
    await logsDTO.createUserLog(`Usuario ${phone} creado desde Mi Negocio`, id_user);

    res.status(201).json({
      ok: true,
      error: 0,
      data: newUser,
      message: 'Usuario creado exitosamente'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      ok: false,
      error: 1,
      data: null,
      message: 'Error al crear el usuario'
    });
  }
}

export const refreshToken = async(req: Request, res: Response) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        ok: false,
        error: 1,
        data: null,
        message: "No se proporcionó un token." 
      });
    }

    const verification = Utils.verify_token(token);

    console.log("token verification", verification);

    return res.status(200).json({
      ok: true,
      error: 0,
      data: verification,
      message: 'Token válido'
    });
  } catch(error){
    console.error(error);
    res.status(500).json({
      ok: false,
      error: 1,
      data: null,
      message: 'Error token invalido'
    });
  }
}
