import { Request, Response, } from 'express'

import { Utils } from '../../core/utils'
import { Client } from './client.service'
import { createClientData } from './client.dto'
import { StorageService } from '../../services/storage.service'
import { resolveImages } from '../../core/asset-resolver'


const clientService = new Client();


export const createClient = async(req: Request, res: Response) => {
    const clientData: createClientData = req.body;
    try {
        const client = await clientService.createClient(clientData);
        res.status(201).json({
            ok: true,
            error: 0,
            data: client,
            message: 'Cliente creado exitosamente'
        });
    } catch (error) {
        res.status(500).json({
            ok: false,
            error: 1,
            data: null,
            message: (error as Error)?.message === 'OWNER_PHONE_EXISTS' ? 'Ese celular ya está registrado como usuario' : 'Error al crear el cliente'
        });
    }
}

export const getClient = async (req: Request, res: Response) => {
    const { id_client } = req.params;

    const clientId = Number(id_client);
    if (isNaN(clientId)) {
        return res.status(400).json({
            ok: false,
            error: 1,
            data: null,
            message: 'El ID del cliente debe ser un número válido'
        });
    }

    try {
        const client = await clientService.getClient(clientId);
        
        if (client) {
            const address = await clientService.getAddressByIdClient(client.id_client);

            return res.json({
                ok: true,
                error: 0,
                data: { ...client, address },
                message: 'Cliente obtenido exitosamente'
            });
        } 
        
        return res.status(404).json({
            ok: false,
            error: 1,
            data: null,
            message: 'Cliente no encontrado'
        });
        
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            ok: false,
            error: 1,
            data: null,
            message: 'Error al obtener el cliente'
        });
    }
}

export const getClientsList = async (req: Request, res: Response) => {
    try {
        
        const todos = await clientService.getClientsList();
        const u: any = req.user;
        const clients = (u && !u.phone && u.i_rol === 2)
            ? (todos as any[]).filter((x: any) => x.id_client === u.id_client)
            : todos;

        return res.json({
            ok: true,
            error: 0,
            data: clients,
            message: 'Clientes obtenidos exitosamente'
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({
            ok: false,
            error: 1,
            data: null,
            message: 'Error al obtener la lista de clientes'
        });
    }
}

export const uploadClientDoc = async (req: Request, res: Response) => {
  const { id_client } = req.params;

  if (!req.file) {
    res.status(400).json({ ok: false, error: 1, data: null, message: 'No se recibió archivo' });
    return;
  }

  try {
    const { url } = await StorageService.uploadAsset({
      entity: 'client_doc',
      entity_id: Number(id_client),
      buffer: req.file.buffer,
      mime: req.file.mimetype,
      id_client: Number(id_client),
      originalName: req.file.originalname,
      optimize: false, // documentos (PDF/imagen) se guardan tal cual
    });

    await clientService.updateSituacionFiscal(Number(id_client), url); // 👈

    res.json({
      ok: true,
      error: 0,
      data: { url },
      message: 'Documento subido exitosamente'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: 1, data: null, message: 'Error al subir documento' });
  }
};

export const deleteClient = async (req: Request, res: Response) => {
    const { id_client } = req.params;
    const id_user = req.user?.id;

    try {
        const client = await clientService.getClient(Number(id_client));

        if (!client) {

            return res.status(404).json({
                ok: false,
                error: 1,
                data: null,
                message: 'Cliente no encontrado'
            });
        }

        if (client.id_user !== id_user) {
            return res.status(403).json({
                ok: false,
                error: 1,
                data: null,
                message: 'No tienes permiso para eliminar este',
            });
        }

        const result = await clientService.deleteClient(Number(id_client), id_user || 0);

        return res.json({
            ok: true,
            error: 0,
            data: result,
            message: 'Cliente eliminado exitosamente'
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            ok: false,
            error: 1,
            data: null,
            message: 'Error al eliminar el cliente'
        });
    }
}
        

export const getCountriesList = async (req: Request, res: Response) => {
    try {
        const countries = await Utils.getCountriesList();
        res.json({
            ok: true,
            error: 0,
            data: countries,
            message: 'Paises obtenidos exitosamente'
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            ok: false,
            error: 1,
            data: null,
            message: 'Error al obtener la lista de paises'
        });
    }
}

export const getStatesList = async (req: Request, res: Response) => {
    const { id_pais } = req.params;
    try {
        const states = await Utils.getStatesList(Number(id_pais));
        res.json({
            ok: true,
            error: 0,
            data: states,
            message: 'Estados obtenidos exitosamente'
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            ok: false,
            error: 1,
            data: null,
            message: 'Error al obtener la lista de estados'
        });
    }
}

export const getCitiesList = async (req: Request, res: Response) => {
    const { id_estado } = req.params;
    try {
        const cities = await Utils.getCitiesList(Number(id_estado));
        res.json({
            ok: true,
            error: 0,
            data: cities,
            message: 'Ciudades obtenidos exitosamente'
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            ok: false,
            error: 1,
            data: null,
            message: 'Error al obtener la lista de ciudades'
        });
    }
}
// Logo del cliente (ej. Sabritas, Coca-Cola) — se usa en la app del
// promotor en vez del mapa estatico al momento de ofrecer una tarea.
export const uploadClientLogo = async (req: Request, res: Response) => {
  const { id_client } = req.params;

  if (!req.file) {
    res.status(400).json({ ok: false, error: 1, data: null, message: 'No se recibió ninguna imagen' });
    return;
  }

  try {
    const { url } = await StorageService.uploadAsset({
      entity: 'client_logo',
      entity_id: Number(id_client),
      buffer: req.file.buffer,
      mime: req.file.mimetype,
    });

    res.json({ ok: true, error: 0, data: { url }, message: 'Logo actualizado exitosamente' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: 1, data: null, message: 'Error al subir el logo' });
  }
};

export const getClientLogo = async (req: Request, res: Response) => {
  try {
    const id_client = Number(req.params.id_client);
    const assetMap = await resolveImages('client_logo', [id_client]);
    res.json({ ok: true, error: 0, data: { url: assetMap.get(id_client) ?? null }, message: 'Consulta exitosa' });
  } catch (error) {
    res.status(500).json({ ok: false, error: 1, data: null, message: 'Error al obtener el logo' });
  }
};
