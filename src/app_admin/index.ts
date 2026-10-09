import express, { Router, Request, Response } from "express";
import ExcelJS from "exceljs";

import { UserAdmin } from "./userAdmin";
import { productAdmin } from "./productAdmin";
import { storesAdmin, CreateStorepayload } from './storesAdmin';
import { QuestionAdmin } from './questionAdmin';
import { QuotationAdmin } from './quotationAdmin';
import { ServiceOrderAdmin } from './serviceOrderAdmin';
import { ServiceAdmin } from './serviceAdmin';
import { RequestAdmin } from './requestAdmin';
import { OrderAdmin } from './orderAdmin';
import { PromoterAdmin } from './promoterAdmin';

import { prisma } from '../core/prisma';

import { upload, uploadExcel } from '../core/middleware/upload.middleware';
import { authMiddleware } from '../core/middleware/auth.middleware';

import { CreateServicePayload } from "../core/interfaces/service";


import userAdminRouter from "../modules/users/routes";

const adminRouter: Router = express.Router();
const getAdminUser = () => new UserAdmin();
const getAdminProduct = () => new productAdmin();
const getAdminStore = () => new storesAdmin();
const getAdminQuestion = () => new QuestionAdmin();
const getAdminQuotation = () => new QuotationAdmin();
const getAdminServiceOrder = () => new ServiceOrderAdmin();
const getAdminService = () => new ServiceAdmin();
const getRequestAdmin = () => new RequestAdmin();
const getOrderAdmin = () => new OrderAdmin();
const getPromoterAdmin = () => new PromoterAdmin();

adminRouter.post(
  "/login",
  async (req: Request, res: Response): Promise<void> => {
    let userModel: UserAdmin | null = null;
    try {
      const { vc_username, vc_password } = req.body;

      if (!vc_username || !vc_password) {
        res.status(400).json({ error: "Email y password son requeridos" });
        return;
      }

      userModel = getAdminUser();
      let result: any;
      try {
        result = await userModel.loginSuperAdmin(vc_username, vc_password);
      } catch (e: any) {
        if (e?.message === "CUENTA_SUSPENDIDA") {
          res.status(403).json({
            error: "Tu cuenta está suspendida. Contacta al administrador de tu negocio.",
            message: "Tu cuenta está suspendida. Contacta al administrador de tu negocio.",
          });
          return;
        }
        throw e;
      }

      console.log("Super admin inició sesión:", result);

      res.status(201).json({
        message: "Super admin inicio session correctamente",
        data: result,
      });
    } catch (error) {
      console.error(error);
      res
        .status(500)
        .json({ error: "Error creando super admin", details: error });
    } finally {
      userModel = null;
    }
  },
);

// Para el login unificado: saber si un celular ya es el usuario de un
// cliente/master registrado, sin necesitar la contraseña todavia (mismo
// patron que ya existe para promotores en /promoters/check-phone).
adminRouter.get(
  "/check-phone/:phone",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const phone = String(req.params.phone || "").trim();
      if (!phone) {
        res.status(400).json({ ok: false, error: 1, data: null, message: "Telefono requerido" });
        return;
      }
      const userModel = getAdminUser();
      let exists = true;
      try {
        await userModel.getUserByEmail(phone);
      } catch {
        exists = false;
      }
      res.status(200).json({ ok: true, error: 0, data: { exists }, message: "Consulta exitosa" });
    } catch (error) {
      console.error("CHECK PHONE ERROR:", error);
      res.status(500).json({ ok: false, error: 1, data: null, message: "Error al verificar el telefono" });
    }
  },
);

// Solo el master puede resetear la contraseña de un usuario a "1234". En
// su siguiente login, el sistema le pedira poner una nueva antes de dejarlo
// avanzar (must_change_password).
adminRouter.patch(
  "/users/:id_user/reset-password",
  authMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (req.user!.i_rol !== 1) {
        res.status(403).json({ ok: false, error: 1, data: null, message: "No autorizado" });
        return;
      }
      const id_user = Number(req.params.id_user);
      const userModel = getAdminUser();
      await userModel.resetPasswordToDefault(id_user);
      res.status(200).json({ ok: true, error: 0, data: null, message: "Contraseña restablecida a 1234" });
    } catch (error) {
      console.error("RESET PASSWORD ERROR:", error);
      res.status(500).json({ ok: false, error: 1, data: null, message: "Error al restablecer la contraseña" });
    }
  },
);

adminRouter.post(
  "/restore-password",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { email } = req.body;
      if (!email) {
        res.status(400).json({ error: "Email es requerido" });
        return;
      }
      const userModel = getAdminUser();
      const result = await userModel.restorePassword(email);
      res.status(200).json({
        message: "Correo enviado correctamente",
        data: result,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({
        error: "Error restaurando contraseña",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  },
);

adminRouter.post("/reset-password", async (req: Request, res: Response): Promise<void> => {
    try {
      const { token, newPassword } = req.body;

      if (!token || !newPassword) {
        res.status(400).json({
          error: "Token y nueva contraseña son requeridos",
        });
        return;
      }

      if (newPassword.length < 6) {
        res.status(400).json({
          error: "La contraseña debe tener al menos 6 caracteres",
        });
        return;
      }

      const userModel = getAdminUser();
      const result = await userModel.resetPasswordWithToken(token, newPassword);

      res.status(200).json({
        message: result.message,
        success: true,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes("Token inválido") || errorMessage.includes("expirado")) {
        res.status(401).json({
          error: errorMessage,
          success: false,
        });
        
        return;
      }

      res.status(500).json({
        error: "Error al restablecer contraseña",
        details: errorMessage,
        success: false,
      });
    }
  },
);

adminRouter.get(
  "/profile",
  authMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;
      const userModel = getAdminUser();
      const user = await userModel.getUserById(userId);

      res.status(200).json({ ok: true, data: user });
    } catch (error) {
      console.error(error);
      res.status(500).json({ ok: false, error: "Error al obtener perfil", details: error instanceof Error ? error.message : String(error) });
    }
  },
);

adminRouter.get(
  "/users/client/:id_client",
  authMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id_client = parseInt(req.params.id_client as string);
      const userModel = getAdminUser();
      const users = await userModel.getUsersByClient(id_client);
      res.status(200).json({ ok: true, data: users });
    } catch (error) {
      console.error(error);
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  },
);

adminRouter.put(
  "/users/:id/email",
  authMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = parseInt(req.params.id as string);
      const { email } = req.body;
      if (!email) {
        res.status(400).json({ ok: false, error: "Email es requerido" });
        return;
      }
      const userModel = getAdminUser();
      const user = await userModel.updateUserEmail(userId, email);
      res.status(200).json({ ok: true, data: user });
    } catch (error) {
      console.error(error);
      const msg = error instanceof Error ? error.message : String(error);
      const status = msg.includes("ya está en uso") ? 409 : 500;
      res.status(status).json({ ok: false, error: msg });
    }
  },
);

adminRouter.put(
  "/users/:id/profile",
  authMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = parseInt(req.params.id as string);
      const { name, lastname } = req.body;
      if (!name || !lastname) {
        res.status(400).json({ ok: false, error: "name y lastname son requeridos" });
        return;
      }
      const userModel = getAdminUser();
      const user = await userModel.updateUserProfile(userId, name, lastname);
      res.status(200).json({ ok: true, data: user });
    } catch (error) {
      console.error(error);
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  },
);

adminRouter.put(
  "/users/:id/rol",
  authMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = parseInt(req.params.id as string);
      const { i_rol } = req.body;
      if (i_rol === undefined || i_rol === null) {
        res.status(400).json({ ok: false, error: "i_rol es requerido" });
        return;
      }
      const userModel = getAdminUser();
      const user = await userModel.updateUserRol(userId, i_rol);
      res.status(200).json({ ok: true, data: user });
    } catch (error) {
      console.error(error);
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  },
);

adminRouter.put(
  "/users/:id/password",
  authMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = parseInt(req.params.id as string);
      const { newPassword } = req.body;
      if (!newPassword) {
        res.status(400).json({ ok: false, error: "newPassword es requerido" });
        return;
      }
      if (newPassword.length < 6) {
        res.status(400).json({ ok: false, error: "La contraseña debe tener al menos 6 caracteres" });
        return;
      }
      const userModel = getAdminUser();
      const result = await userModel.resetUserPassword(userId, newPassword);
      res.status(200).json({ ok: true, message: result.message });
    } catch (error) {
      console.error(error);
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  },
);

adminRouter.delete(
  "/users/:id",
  authMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = parseInt(req.params.id as string);
      const userModel = getAdminUser();
      const result = await userModel.deactivateUser(userId);
      res.status(200).json({ ok: true, message: result.message });
    } catch (error) {
      console.error(error);
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  },
);

adminRouter.put(
  "/users/:id/activate",
  authMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = parseInt(req.params.id as string);
      const userModel = getAdminUser();
      const result = await userModel.activateUser(userId);
      res.status(200).json({ ok: true, message: result.message });
    } catch (error) {
      console.error(error);
      res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  },
);

adminRouter.post(
  "/change-password",
  authMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { currentPassword, newPassword } = req.body;
      const userId = req.user!.id;

      if (!currentPassword || !newPassword) {
        res.status(400).json({ error: "Contraseña actual y nueva contraseña son requeridas" });
        return;
      }

      if (newPassword.length < 6) {
        res.status(400).json({ error: "La nueva contraseña debe tener al menos 6 caracteres" });
        return;
      }

      const userModel = getAdminUser();
      const result = await userModel.changePassword(userId, currentPassword, newPassword);

      res.status(200).json({ message: result.message, success: true });
    } catch (error) {
      console.error(error);
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes("incorrecta")) {
        res.status(401).json({ error: errorMessage, success: false });
        return;
      }

      res.status(500).json({ error: "Error al cambiar contraseña", details: errorMessage, success: false });
    }
  },
);

adminRouter.post(
  "/change-password-forced",
  authMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { newPassword } = req.body;
      if (!newPassword || String(newPassword).length < 6) {
        res.status(400).json({ error: "La nueva contraseña debe tener al menos 6 caracteres", success: false });
        return;
      }
      const userModel = getAdminUser();
      const result = await userModel.forceChangePassword(req.user!.id, String(newPassword));
      res.status(200).json({ message: result.message, success: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg === "NO_REQUIERE_CAMBIO") {
        res.status(403).json({ error: "Esta cuenta no requiere un cambio obligatorio de contraseña", success: false });
        return;
      }
      console.error("FORCED PASSWORD ERROR:", msg);
      res.status(500).json({ error: "Error al cambiar contraseña", success: false });
    }
  },
);

// adminRouter.post("/create-user-in-client", async (req: Request, res: Response): Promise<void> => {
//   try {
//     const { name, lastname, email, id_client, id_user_creator } = req.body;
//     const userAdmin = getAdminUser();
//     const result = await userAdmin.createUserInClient(name, lastname, email, id_client, id_user_creator);
//     res.status(201).json({
//       message: "Usuario creado exitosamente",
//       data: result,
//     });

//   } catch (error) {
//     console.error(error);
//     res.status(500).json({
//       error: "Error creando usuario",
//       details: error instanceof Error ? error.message : String(error),
//     });
//   }
// });

adminRouter.post("/products", async (req: Request, res: Response): Promise<void> => {
  try {
    const { id_user, id_client, name, description, vc_image } = req.body;

    if (!id_user || !id_client || !name) {
      res.status(400).json({ error: "id_user, id_client y name son requeridos" });
      return;
    }

    const productModel = getAdminProduct();
    const result = await productModel.createProduct(id_user, id_client, name, {
      description,
      vc_image
    });

    res.status(201).json({
      message: "Producto creado exitosamente",
      data: result,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Error creando producto",
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

adminRouter.get("/products/client/:id_client", async (req: Request, res: Response): Promise<void> => {
  try {
    const { id_client } = req.params;

    if (!id_client) {
      res.status(400).json({ error: "id_client es requerido" });
      return;
    }

    const productModel = getAdminProduct();
    const products = await productModel.getProductsByClient(Number(id_client));

    res.status(200).json({
      message: "Productos obtenidos exitosamente",
      data: products,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Error obteniendo productos",
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

adminRouter.get("/products/:id_product", async (req: Request, res: Response): Promise<void> => {
  try {
    const { id_product } = req.params;

    if (!id_product) {
      res.status(400).json({ error: "id_product es requerido" });
      return;
    }

    const productModel = getAdminProduct();
    const product = await productModel.getProductById(Number(id_product));

    if (!product) {
      res.status(404).json({ error: "Producto no encontrado" });
      return;
    }

    res.status(200).json({
      message: "Producto obtenido exitosamente",
      data: product,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Error obteniendo producto",
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

adminRouter.post(
  "/products/:id_product/image",
  upload.single("image"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id_product } = req.params;
      const { id_client } = req.body;

      if (!req.file) {
        res.status(400).json({ error: "No se envió ninguna imagen" });
        return;
      }

      const productModel = getAdminProduct();

      const imageUrl = await productModel.uploadProductImage(
        Number(id_client),
        Number(id_product),
        req.file.buffer
      );

      await productModel.updateProductImage(Number(id_product), imageUrl);

      res.status(200).json({
        message: "Imagen subida exitosamente",
        data: { url: imageUrl },
      });
    } catch (error) {
      console.error("Error subiendo imagen:", error);
      res.status(500).json({
        error: "Error al subir imagen",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }
);

adminRouter.put("/products/:id_product", async (req: Request, res: Response): Promise<void> => {
  try {
    const { id_product } = req.params;
    const { id_user, name, description } = req.body;

    if (!id_product) {
      res.status(400).json({ error: "id_product es requerido" });
      return;
    }

    if (!id_user) {
      res.status(400).json({ error: "id_user es requerido" });
      return;
    }

    const productModel = getAdminProduct();
    const result = await productModel.updateProduct(Number(id_product), id_user, {
      name,
      description,
    });

    res.status(200).json({
      message: result.message,
      success: result.success,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Error actualizando producto",
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

// Eliminar producto (soft delete)
adminRouter.delete("/products/:id_product", async (req: Request, res: Response): Promise<void> => {
  try {
    const { id_product } = req.params;
    const { id_user } = req.body;

    if (!id_product) {
      res.status(400).json({ error: "id_product es requerido" });
      return;
    }

    if (!id_user) {
      res.status(400).json({ error: "id_user es requerido" });
      return;
    }

    const productModel = getAdminProduct();
    const result = await productModel.deleteProduct(Number(id_product), id_user);

    res.status(200).json({
      message: result.message,
      success: result.success,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Error eliminando producto",
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

adminRouter.post("/store", async(req: Request, res: Response): Promise<void> => {
  try {

    const { 
      id_client, 
      id_user_creator, 
      name,
      store_code,
      street,
      ext_number,
      int_number,
      neighborhood,
      municipality,
      state,
      postal_code,
      country,
      latitude,
      longitude
    } = req.body


    const store_payload: CreateStorepayload = {
      id_client: parseInt(id_client),
      id_user_creator: parseInt(id_user_creator),
      name,
      store_code,
      street,
      ext_number,
      int_number,
      neighborhood,
      municipality,
      state,
      postal_code,
      country,
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude)
    }

    const storeModel = getAdminStore();
    const result = await storeModel.createStoreAdmin(store_payload);

    res.status(200).json({
      ok: true,
      message: "Establecimiento creado exitosamente",
      data: result,
    });
    
  } catch (error) {
    console.error(error);
    res.status(500).json({
      ok: false,
      message: "Error eliminando producto",
      data: error instanceof Error ? error.message : String(error),
    });
  }
})

adminRouter.get("/stores/:id_client", async (req: Request, res: Response): Promise<void> => {
    try {
        // Nota: las tiendas ya no estan ligadas a un cliente en particular
        // (no existe tabla stores_clients en el esquema actual) -- son un
        // directorio compartido, igual que en el modulo moderno de
        // Establecimientos. Se listan todas las activas.
        const result = await prisma.stores.findMany({
            where: { i_status: 1 },
            orderBy: { name: 'asc' },
        });

        res.status(200).json({
            ok: true,
            message: "Establecimientos obtenidos exitosamente",
            data: result,
        });
        
    } catch (error) {
        console.error(error);
        res.status(500).json({
            ok: false,
            message: "Error obteniendo establecimientos",
            data: error instanceof Error ? error.message : String(error),
        });
    }
});

adminRouter.get("/store-client/:id_store_client", async (req: Request, res: Response): Promise<void> => {
    try {
        const { id_store_client } = req.params;

        const storeModel = getAdminStore();
        const result = await storeModel.getStoreByIdClient(Number(id_store_client));

        if (!result) {
            res.status(404).json({
                ok: false,
                message: "Establecimiento no encontrado",
                data: null,
            });
            return;
        }

        res.status(200).json({
            ok: true,
            message: "Establecimiento obtenido exitosamente",
            data: result.data,
        });
        
    } catch (error) {
        console.error(error);
        res.status(500).json({
            ok: false,
            message: "Error obteniendo establecimiento",
            data: error instanceof Error ? error.message : String(error),
        });
    }
});

// PUT - Actualizar establecimiento
adminRouter.put("/store-client/:id_store_client", async (req: Request, res: Response): Promise<void> => {
    try {
        const { id_store_client } = req.params;
        const { 
            id_client, 
            id_user_creator, 
            name,
            store_code,
            street,
            ext_number,
            int_number,
            neighborhood,
            municipality,
            state,
            postal_code,
            country,
            latitude,
            longitude
        } = req.body;

        const store_payload: CreateStorepayload = {
            id_store_client: Number(id_store_client),
            id_client: Number(id_client),
            id_user_creator: Number(id_user_creator),
            name,
            store_code,
            street,
            ext_number,
            int_number,
            neighborhood,
            municipality,
            state,
            postal_code,
            country,
            latitude: parseFloat(latitude),
            longitude: parseFloat(longitude)
        };

        const storeModel = getAdminStore();
        const result = await storeModel.updateStoreForClient(store_payload);

        res.status(200).json({
            ok: true,
            message: "Establecimiento actualizado exitosamente",
            data: result,
        });
        
    } catch (error) {
        console.error(error);
        res.status(500).json({
            ok: false,
            message: "Error actualizando establecimiento",
            data: error instanceof Error ? error.message : String(error),
        });
    }
});

adminRouter.delete("/store-client/:id_store_client", async(req: Request, res: Response) => {
  try {
    const { id_store_client } = req.params;
    const { id_user } = req.body;

    if (!id_user) {
      res.status(400).json({
        ok: false,
        message: "id_user es requerido",
        data: null,
      });
      return;
    }

    const storeModel = getAdminStore();
    const result = await storeModel.deleteStoreForClient(Number(id_store_client), id_user);

    if (!result) {
      res.status(404).json({
        ok: false,
        message: "Establecimiento no encontrado",
        data: null,
      });
      return;
    }

    res.status(200).json({
      ok: true,
      message: "Establecimiento eliminado exitosamente",
      data: result.data,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: "Error eliminando establecimiento",
      data: error instanceof Error ? error.message : String(error),
    });
  }
});

adminRouter.post("/stores/import-excel", uploadExcel.single("file"), async (req: Request, res: Response): Promise<void> => {
    try {
        const { id_client, id_user } = req.body;
        const file = req.file;

        if (!file) {
            res.status(400).json({
                ok: false,
                message: "No se recibió ningún archivo",
            });
            return;
        }

        if (!id_client || !id_user) {
            res.status(400).json({
                ok: false,
                message: "Faltan parámetros: id_client o id_user",
            });
            return;
        }

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(file.buffer as unknown as ArrayBuffer);
        const worksheet = workbook.worksheets[0];
        if (!worksheet) {
            res.status(400).json({
                ok: false,
                message: "El archivo Excel no tiene hojas",
            });
            return;
        }

        const data: any[] = [];
        let headers: string[] = [];
        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) {
                headers = row.values as string[];
                headers = headers.map((h: string | undefined) => (h != null ? String(h).trim() : ""));
                return;
            }
            const obj: Record<string, any> = {};
            row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                const header = headers[colNumber - 1];
                if (header) {
                    obj[header] = cell.value != null ? cell.value : "";
                }
            });
            data.push(obj);
        });

        if (data.length === 0) {
            res.status(400).json({
                ok: false,
                message: "El archivo Excel está vacío",
            });
            return;
        }

        // Procesar e insertar
        const storeModel = getAdminStore();
        const result = await storeModel.importStoresFromExcel(parseInt(id_client), parseInt(id_user), data);

        res.status(200).json({
            ok: true,
            message: `Se importaron ${result.inserted} establecimientos correctamente`,
            data: result,
        });

    } catch (error) {
        console.error("Error importando Excel:", error);
        res.status(500).json({
            ok: false,
            message: "Error procesando archivo Excel",
            data: error instanceof Error ? error.message : String(error),
        });
    }
});

// ==================== QUESTIONS (Solo lectura para Admin) ====================

// Obtener todas las preguntas asignadas al cliente
adminRouter.get("/questions/:id_client", async (req: Request, res: Response): Promise<void> => {
    try {
        const { id_client } = req.params;

        if (!id_client) {
            res.status(400).json({
                ok: false,
                message: "id_client es requerido",
            });
            return;
        }

        const questionModel = getAdminQuestion();
        const questions = await questionModel.getQuestionsForClient(Number(id_client));

        res.status(200).json({
            ok: true,
            message: "Preguntas obtenidas exitosamente",
            data: questions,
        });
    } catch (error) {
        res.status(500).json({
            ok: false,
            message: "Error obteniendo preguntas",
            data: error instanceof Error ? error.message : String(error),
        });
    }
});

// Obtener una pregunta específica asignada al cliente
adminRouter.get("/questions/:id_client/:id_question_client", async (req: Request, res: Response): Promise<void> => {
    try {
        const { id_client, id_question_client } = req.params;

        if (!id_client || !id_question_client) {
            res.status(400).json({
                ok: false,
                message: "id_client e id_question_client son requeridos",
            });
            return;
        }

        const questionModel = getAdminQuestion();
        const result = await questionModel.getQuestionForClient(
            Number(id_question_client),
            Number(id_client)
        );

        if (!result.ok) {
            res.status(404).json(result);
            return;
        }

        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({
            ok: false,
            message: "Error obteniendo pregunta",
            data: error instanceof Error ? error.message : String(error),
        });
    }
});

// Buscar preguntas del cliente por texto
adminRouter.get("/questions/:id_client/search/:search_term", async (req: Request, res: Response): Promise<void> => {
    try {
        const { id_client, search_term } = req.params;

        if (!id_client || !search_term) {
            res.status(400).json({
                ok: false,
                message: "id_client y search_term son requeridos",
            });
            return;
        }

        const questionModel = getAdminQuestion();
        const questions = await questionModel.searchQuestionsForClient(
            Number(id_client),
            String(search_term)
        );

        res.status(200).json({
            ok: true,
            message: "Búsqueda completada exitosamente",
            data: questions,
        });
    } catch (error) {
        res.status(500).json({
            ok: false,
            message: "Error buscando preguntas",
            data: error instanceof Error ? error.message : String(error),
        });
    }
});

// Búsqueda por query param (alternativa más flexible)
adminRouter.post("/questions/search", async (req: Request, res: Response): Promise<void> => {
    try {
        const { id_client, search } = req.body;

        if (!id_client) {
            res.status(400).json({
                ok: false,
                message: "id_client es requerido",
            });
            return;
        }

        const questionModel = getAdminQuestion();

        let questions;
        if (search && search.trim() !== '') {
            questions = await questionModel.searchQuestionsForClient(Number(id_client), search);
        } else {
            questions = await questionModel.getQuestionsForClient(Number(id_client));
        }

        res.status(200).json({
            ok: true,
            message: "Preguntas obtenidas exitosamente",
            data: questions,
        });
    } catch (error) {
        res.status(500).json({
            ok: false,
            message: "Error obteniendo preguntas",
            data: error instanceof Error ? error.message : String(error),
        });
    }
});

// Obtener estadísticas de preguntas del cliente
adminRouter.get("/questions/:id_client/stats", async (req: Request, res: Response): Promise<void> => {
    try {
        const { id_client } = req.params;

        if (!id_client) {
            res.status(400).json({
                ok: false,
                message: "id_client es requerido",
            });
            return;
        }

        const questionModel = getAdminQuestion();
        const stats = await questionModel.getQuestionStatsForClient(Number(id_client));

        res.status(200).json({
            ok: true,
            message: "Estadísticas obtenidas exitosamente",
            data: stats,
        });
    } catch (error) {
        res.status(500).json({
            ok: false,
            message: "Error obteniendo estadísticas",
            data: error instanceof Error ? error.message : String(error),
        });
    }
});

// ==================== QUOTATIONS (Cotizaciones) ====================

// Crear cotización
adminRouter.post("/quotations", async (req: Request, res: Response): Promise<void> => {
    try {
        const { id_client, id_user, quotation_name, products, questions, stores } = req.body;

        if (!id_client || !id_user || !quotation_name) {
            res.status(400).json({
                ok: false,
                message: "id_client, id_user y quotation_name son requeridos",
            });
            return;
        }

        const quotationModel = getAdminQuotation();
        const result = await quotationModel.createQuotation(id_user, {
            id_client,
            quotation_name,
            products,
            questions,
            stores
        });

        res.status(201).json(result);
    } catch (error) {
        res.status(500).json({
            ok: false,
            message: "Error creando cotización",
            data: error instanceof Error ? error.message : String(error),
        });
    }
});

// Obtener cotizaciones de un cliente
adminRouter.get("/quotations/:id_client", async (req: Request, res: Response): Promise<void> => {
    try {
        const { id_client } = req.params;

        if (!id_client) {
            res.status(400).json({
                ok: false,
                message: "id_client es requerido",
            });
            return;
        }

        const quotationModel = getAdminQuotation();
        const quotations = await quotationModel.getQuotationsForClient(Number(id_client));

        res.status(200).json({
            ok: true,
            message: "Cotizaciones obtenidas exitosamente",
            data: quotations,
        });
    } catch (error) {
        res.status(500).json({
            ok: false,
            message: "Error obteniendo cotizaciones",
            data: error instanceof Error ? error.message : String(error),
        });
    }
});

// Obtener detalle de una cotización
adminRouter.get("/quotations/:id_client/:id_quotation", async (req: Request, res: Response): Promise<void> => {
    try {
        const { id_client, id_quotation } = req.params;

        if (!id_client || !id_quotation) {
            res.status(400).json({
                ok: false,
                message: "id_client e id_quotation son requeridos",
            });
            return;
        }

        const quotationModel = getAdminQuotation();
        const result = await quotationModel.getQuotationById(
            Number(id_quotation),
            Number(id_client)
        );

        if (!result.ok) {
            res.status(404).json(result);
            return;
        }

        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({
            ok: false,
            message: "Error obteniendo cotización",
            data: error instanceof Error ? error.message : String(error),
        });
    }
});

// Obtener preview de precios de una cotización
adminRouter.get("/quotations/:id_client/:id_quotation/preview", async (req: Request, res: Response): Promise<void> => {
    try {
        const { id_client, id_quotation } = req.params;

        if (!id_client || !id_quotation) {
            res.status(400).json({
                ok: false,
                message: "id_client e id_quotation son requeridos",
            });
            return;
        }

        const quotationModel = getAdminQuotation();
        const result = await quotationModel.getQuotationPricePreview(
            Number(id_quotation),
            Number(id_client)
        );

        if (!result.ok) {
            res.status(404).json(result);
            return;
        }

        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({
            ok: false,
            message: "Error obteniendo preview de cotización",
            data: error instanceof Error ? error.message : String(error),
        });
    }
});

// Actualizar cotización
adminRouter.put("/quotations/:id_client/:id_quotation", async (req: Request, res: Response): Promise<void> => {
    try {
        const { id_client, id_quotation } = req.params;
        const { id_user, quotation_name, products, questions, stores, i_status } = req.body;

        if (!id_client || !id_quotation || !id_user) {
            res.status(400).json({
                ok: false,
                message: "id_client, id_quotation e id_user son requeridos",
            });
            return;
        }

        const quotationModel = getAdminQuotation();
        const result = await quotationModel.updateQuotation(
            Number(id_quotation),
            Number(id_client),
            id_user,
            { quotation_name, products, questions, stores, i_status }
        );

        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({
            ok: false,
            message: "Error actualizando cotización",
            data: error instanceof Error ? error.message : String(error),
        });
    }
});

// Eliminar cotización
adminRouter.delete("/quotations/:id_client/:id_quotation", async (req: Request, res: Response): Promise<void> => {
    try {
        const { id_client, id_quotation } = req.params;
        const { id_user } = req.body;

        if (!id_client || !id_quotation || !id_user) {
            res.status(400).json({
                ok: false,
                message: "id_client, id_quotation e id_user son requeridos",
            });
            return;
        }

        const quotationModel = getAdminQuotation();
        const result = await quotationModel.deleteQuotation(
            Number(id_quotation),
            Number(id_client),
            id_user
        );

        if (!result.ok) {
            res.status(404).json(result);
            return;
        }

        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({
            ok: false,
            message: "Error eliminando cotización",
            data: error instanceof Error ? error.message : String(error),
        });
    }
});

// Obtener logs de una cotización
adminRouter.get("/quotations/:id_client/:id_quotation/logs", async (req: Request, res: Response): Promise<void> => {
    try {
        const { id_client, id_quotation } = req.params;

        if (!id_client || !id_quotation) {
            res.status(400).json({
                ok: false,
                message: "id_client e id_quotation son requeridos",
            });
            return;
        }

        const quotationModel = getAdminQuotation();
        const result = await quotationModel.getQuotationLogs(
            Number(id_quotation),
            Number(id_client)
        );

        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({
            ok: false,
            message: "Error obteniendo logs de cotización",
            data: error instanceof Error ? error.message : String(error),
        });
    }
});

// ==================== SERVICE ORDERS (Órdenes de Servicio) ====================

// Confirmar cotización y crear orden de servicio + tickets
adminRouter.post("/service-orders/confirm", async (req: Request, res: Response): Promise<void> => {
    try {
        const { id_quotation, id_client, id_user } = req.body;

        if (!id_quotation || !id_client || !id_user) {
            res.status(400).json({
                ok: false,
                message: "id_quotation, id_client e id_user son requeridos",
            });
            return;
        }

        const serviceOrderModel = getAdminServiceOrder();
        const result = await serviceOrderModel.confirmQuotationAndCreateOrder(
            id_quotation,
            id_client,
            id_user
        );

        res.status(201).json(result);
    } catch (error) {
        res.status(500).json({
            ok: false,
            message: "Error confirmando cotización",
            data: error instanceof Error ? error.message : String(error),
        });
    }
});

// Obtener órdenes de servicio de un cliente
adminRouter.get("/service-orders/:id_client", async (req: Request, res: Response): Promise<void> => {
    try {
        const { id_client } = req.params;

        if (!id_client) {
            res.status(400).json({
                ok: false,
                message: "id_client es requerido",
            });
            return;
        }

        const serviceOrderModel = getAdminServiceOrder();
        const orders = await serviceOrderModel.getServiceOrdersForClient(Number(id_client));

        res.status(200).json({
            ok: true,
            message: "Órdenes obtenidas exitosamente",
            data: orders,
        });
    } catch (error) {
        res.status(500).json({
            ok: false,
            message: "Error obteniendo órdenes",
            data: error instanceof Error ? error.message : String(error),
        });
    }
});

// Obtener detalle de una orden de servicio
adminRouter.get("/service-orders/:id_client/:id_service_order", async (req: Request, res: Response): Promise<void> => {
    try {
        const { id_client, id_service_order } = req.params;

        if (!id_client || !id_service_order) {
            res.status(400).json({
                ok: false,
                message: "id_client e id_service_order son requeridos",
            });
            return;
        }

        const serviceOrderModel = getAdminServiceOrder();
        const result = await serviceOrderModel.getServiceOrderById(
            Number(id_service_order),
            Number(id_client)
        );

        if (!result.ok) {
            res.status(404).json(result);
            return;
        }

        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({
            ok: false,
            message: "Error obteniendo orden",
            data: error instanceof Error ? error.message : String(error),
        });
    }
});

// Marcar orden como pagada
adminRouter.post("/service-orders/:id_client/:id_service_order/pay", async (req: Request, res: Response): Promise<void> => {
    try {
        const { id_client, id_service_order } = req.params;
        const { id_user } = req.body;

        if (!id_client || !id_service_order || !id_user) {
            res.status(400).json({
                ok: false,
                message: "id_client, id_service_order e id_user son requeridos",
            });
            return;
        }

        const serviceOrderModel = getAdminServiceOrder();
        const result = await serviceOrderModel.markOrderAsPaid(
            Number(id_service_order),
            Number(id_client),
            id_user
        );

        if (!result.ok) {
            res.status(400).json(result);
            return;
        }

        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({
            ok: false,
            message: "Error registrando pago",
            data: error instanceof Error ? error.message : String(error),
        });
    }
});

// Obtener logs de una orden
adminRouter.get("/service-orders/:id_client/:id_service_order/logs", async (req: Request, res: Response): Promise<void> => {
    try {
        const { id_client, id_service_order } = req.params;

        if (!id_client || !id_service_order) {
            res.status(400).json({
                ok: false,
                message: "id_client e id_service_order son requeridos",
            });
            return;
        }

        const serviceOrderModel = getAdminServiceOrder();
        const result = await serviceOrderModel.getServiceOrderLogs(
            Number(id_service_order),
            Number(id_client)
        );

        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({
            ok: false,
            message: "Error obteniendo logs de orden",
            data: error instanceof Error ? error.message : String(error),
        });
    }
});

// Estadísticas de órdenes y tickets del cliente
adminRouter.get("/service-orders/:id_client/stats", async (req: Request, res: Response): Promise<void> => {
    try {
        const { id_client } = req.params;

        if (!id_client) {
            res.status(400).json({
                ok: false,
                message: "id_client es requerido",
            });
            return;
        }

        const serviceOrderModel = getAdminServiceOrder();
        const stats = await serviceOrderModel.getServiceStatsForClient(Number(id_client));

        res.status(200).json({
            ok: true,
            message: "Estadísticas obtenidas exitosamente",
            data: stats,
        });
    } catch (error) {
        res.status(500).json({
            ok: false,
            message: "Error obteniendo estadísticas",
            data: error instanceof Error ? error.message : String(error),
        });
    }
});

// ==================== TICKETS ====================

// Obtener todos los tickets de un cliente
adminRouter.get("/tickets/:id_client", async (req: Request, res: Response): Promise<void> => {
    try {
        const { id_client } = req.params;
        const { ticket_status, id_store } = req.query;

        if (!id_client) {
            res.status(400).json({
                ok: false,
                message: "id_client es requerido",
            });
            return;
        }

        const serviceOrderModel = getAdminServiceOrder();
        const tickets = await serviceOrderModel.getTicketsForClient(Number(id_client), {
            ticket_status: ticket_status !== undefined ? Number(ticket_status) as 0 | 1 | 2 | 3 : undefined,
            id_store: id_store !== undefined ? Number(id_store) : undefined,
        });

        res.status(200).json({
            ok: true,
            message: "Tickets obtenidos exitosamente",
            data: tickets,
        });
    } catch (error) {
        res.status(500).json({
            ok: false,
            message: "Error obteniendo tickets",
            data: error instanceof Error ? error.message : String(error),
        });
    }
});

// Obtener detalle de un ticket
adminRouter.get("/tickets/:id_client/:id_ticket", async (req: Request, res: Response): Promise<void> => {
    try {
        const { id_client, id_ticket } = req.params;

        if (!id_client || !id_ticket) {
            res.status(400).json({
                ok: false,
                message: "id_client e id_ticket son requeridos",
            });
            return;
        }

        const serviceOrderModel = getAdminServiceOrder();
        const result = await serviceOrderModel.getTicketById(
            Number(id_ticket),
            Number(id_client)
        );

        if (!result.ok) {
            res.status(404).json(result);
            return;
        }

        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({
            ok: false,
            message: "Error obteniendo ticket",
            data: error instanceof Error ? error.message : String(error),
        });
    }
});

// Obtener logs de un ticket
adminRouter.get("/tickets/:id_client/:id_ticket/logs", async (req: Request, res: Response): Promise<void> => {
    try {
        const { id_client, id_ticket } = req.params;

        if (!id_client || !id_ticket) {
            res.status(400).json({
                ok: false,
                message: "id_client e id_ticket son requeridos",
            });
            return;
        }

        const serviceOrderModel = getAdminServiceOrder();
        const result = await serviceOrderModel.getTicketLogs(
            Number(id_ticket),
            Number(id_client)
        );

        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({
            ok: false,
            message: "Error obteniendo logs del ticket",
            data: error instanceof Error ? error.message : String(error),
        });
    }
});

// ++++++++++++++++++++++++ SERVICIO ++++++++++++++++++++++++
adminRouter.post("/service", async (req: Request, res: Response): Promise<void> => {
    try {
        const { id_client, id_user }:CreateServicePayload  = req.body;

        if (!id_client || !id_user) {
            res.status(400).json({
                ok: false,
                message: "hay datos faltantes y son requeridos",
            });
            return;
        }

        const serviceModel = getAdminService();
        const result = await serviceModel.registerService({
            id_client,
            id_user
        });

        res.status(200).json({
            ok: true,
            message: "Servicio creado exitosamente",
            data: result,
        });
        
    } catch (error) {
        res.status(500).json({
            ok: false,
            message: "Error obteniendo logs del ticket",
            data: error instanceof Error ? error.message : String(error),
        });
    }
});

// ==========================================
// RUTAS PARA SOLICITUDES (REQUESTS)
// ==========================================

// 1. CREAR NUEVA SOLICITUD
adminRouter.post(
  "/requests",
  async (req: Request, res: Response): Promise<void> => {
    let requestModel: RequestAdmin | null = null;
    try {
      // Extraemos el JSON que manda el frontend
      const { id_cliente, nombre_solicitud, costo_total, productos } = req.body;

      // OJO: Si tienes el id del usuario en el token (req.user), úsalo aquí. 
      // Por ahora lo tomamos del body o le ponemos un valor por defecto para que no falle.
      const id_user = req.body.id_user || 1; 

      if (!id_cliente || !nombre_solicitud || !productos || !Array.isArray(productos)) {
        res.status(400).json({ error: "Faltan datos obligatorios o el formato es incorrecto" });
        return;
      }

      requestModel = getRequestAdmin();
      const result = await requestModel.createRequest({
        id_user,
        id_cliente,
        nombre_solicitud,
        costo_total,
        productos
      });

      res.status(201).json({
        ok: true,
        message: "Solicitud creada correctamente",
        data: result,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ ok: false, error: "Error creando la solicitud", details: error });
    } finally {
      requestModel = null;
    }
  }
);

// 2. OBTENER SOLICITUDES POR CLIENTE
adminRouter.get(
  "/requests/client/:id_client",
  async (req: Request, res: Response): Promise<void> => {
    let requestModel: RequestAdmin | null = null;
    try {
      const id_client = parseInt(String(req.params.id_client));

      if (isNaN(id_client)) {
        res.status(400).json({ error: "El id_client debe ser un número válido" });
        return;
      }

      requestModel = getRequestAdmin();
      const result = await requestModel.getRequestsByClient(id_client);

      res.status(200).json({
        ok: true,
        data: result,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ ok: false, error: "Error obteniendo las solicitudes", details: error });
    } finally {
      requestModel = null;
    }
  }
);

// 3. OBTENER DETALLE DE UNA SOLICITUD (Con productos y preguntas)
adminRouter.get(
  "/requests/:id_request",
  async (req: Request, res: Response): Promise<void> => {
    let requestModel: RequestAdmin | null = null;
    try {
      const id_request = parseInt(String(req.params.id_request));

      if (isNaN(id_request)) {
        res.status(400).json({ error: "El id_request debe ser un número válido" });
        return;
      }

      requestModel = getRequestAdmin();
      const result = await requestModel.getRequestById(id_request);

      if (!result) {
        res.status(404).json({ ok: false, error: "Solicitud no encontrada" });
        return;
      }

      res.status(200).json({
        ok: true,
        data: result,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ ok: false, error: "Error obteniendo el detalle de la solicitud", details: error });
    } finally {
      requestModel = null;
    }
  }
);

// ACTUALIZAR SOLICITUD COMPLETA (Productos y Preguntas)
adminRouter.put(
  "/requests/:id_request/full",
  async (req: Request, res: Response): Promise<void> => {
    let requestModel: RequestAdmin | null = null;
    try {
      const id_request = parseInt(String(req.params.id_request));
      // Recibimos el mismo payload que usamos para Crear
      const { id_cliente, nombre_solicitud, costo_total, productos } = req.body;
      const id_user = req.body.id_user || 1;

      if (isNaN(id_request)) {
        res.status(400).json({ error: "El id_request debe ser un número válido" });
        return;
      }

      if (!nombre_solicitud || !productos || !Array.isArray(productos)) {
        res.status(400).json({ error: "Faltan datos obligatorios para la actualización completa" });
        return;
      }

      requestModel = getRequestAdmin();
      const result = await requestModel.updateFullRequest(id_request, {
        id_user,
        id_cliente,
        nombre_solicitud,
        costo_total,
        productos
      });

      res.status(200).json({
        ok: true,
        data: result,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ ok: false, error: "Error actualizando la solicitud completa", details: error });
    } finally {
      requestModel = null;
    }
  }
);

// 5. ELIMINAR SOLICITUD (Borrado lógico)
adminRouter.delete(
  "/requests/:id_request",
  async (req: Request, res: Response): Promise<void> => {
    let requestModel: RequestAdmin | null = null;
    try {
      const id_request = parseInt(String(req.params.id_request));

      if (isNaN(id_request)) {
        res.status(400).json({ error: "El id_request debe ser un número válido" });
        return;
      }

      requestModel = getRequestAdmin();
      const result = await requestModel.deleteRequest(id_request);

      res.status(200).json({
        ok: true,
        data: result,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ ok: false, error: "Error eliminando la solicitud", details: error });
    } finally {
      requestModel = null;
    }
  }
);

// interface CreateOrderPayload {
//     id_user: number;
//     id_client: number;
//     id_request: number;
//     stores: number[];
// }

adminRouter.post('/orders', async (req: Request, res: Response): Promise<void> => {
  let orderModel: OrderAdmin | null = null;
  try {
    const { id_user, id_client, id_request, stores } = req.body;

    orderModel = getOrderAdmin();
    const result = await orderModel.createOrder({
      id_user,
      id_client,
      id_request,
      stores
    });

    res.status(201).json({
      ok: true,
      message: "Orden creada exitosamente",
      data: result,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: "Error creando la orden", details: error });
  } finally {
    orderModel = null;
  }
});


adminRouter.get('/orders/client/:id_client', async (req: Request, res: Response): Promise<void> => {
  try {
    const id_client = parseInt(String(req.params.id_client));

    if (isNaN(id_client)) {
      res.status(400).json({ ok: false, error: "El id_client debe ser un número válido" });
      return;
    }

    const result = await prisma.orders.findMany({
      where: { id_client, id_status: { not: 0 } },
      orderBy: { dt_register: 'desc' },
    });

    res.status(200).json({
      ok: true,
      data: result,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: "Error obteniendo los pedidos del cliente", details: error });
  }
});

// GET: Obtener el detalle de un pedido (incluyendo sus tareas)
adminRouter.get('/orders/:id_order', async (req: Request, res: Response): Promise<void> => {
  let orderModel: OrderAdmin | null = null;
  try {
    const id_order = parseInt(String(req.params.id_order));

    if (isNaN(id_order)) {
      res.status(400).json({ ok: false, error: "El id_order debe ser un número válido" });
      return;
    }

    orderModel = getOrderAdmin();
    const result = await orderModel.getOrderById(id_order);

    if (!result) {
      res.status(404).json({ ok: false, error: "Pedido no encontrado" });
      return;
    }

    res.status(200).json({
      ok: true,
      data: result,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: "Error obteniendo el detalle del pedido", details: error });
  } finally {
    orderModel = null;
  }
});

adminRouter.put('/admin/task/:id_task/assign', async (req: Request, res: Response): Promise<void> => {
    let orderModel: OrderAdmin | null = null;
    try {
        const id_task = parseInt(String(req.params.id_task));
        const { id_promoter } = req.body;
        if (isNaN(id_task) || !id_promoter) {
            res.status(400).json({ ok: false, error: "El id_task debe ser un número válido y se requiere id_promoter" });
            return;
        }
        orderModel = getOrderAdmin();
        const result = await orderModel.assignPromoterToTask(id_task, id_promoter);
        res.status(200).json({ ok: true, data: result });
    } catch (error) {
      console.error(error);
      res.status(500).json({ ok: false, error: "Error asignando tarea", details: error });
    }
});

adminRouter.put('/admin/task/:id_task/reject', async (req: Request, res: Response): Promise<void> => {
    let orderModel: OrderAdmin | null = null;
    try {
        const id_task = parseInt(String(req.params.id_task));
        if (isNaN(id_task)) {
            res.status(400).json({ ok: false, error: "El id_task debe ser un número válido" });
            return;
        }
        orderModel = getOrderAdmin();
        const result = await orderModel.rejectTask(id_task);
        res.status(200).json({ ok: true, data: result });
    } catch (error: any) {
        console.error(error);
        const isValidationError = error?.message?.includes("no está en estatus 5");
        res.status(isValidationError ? 409 : 500).json({ ok: false, error: error?.message ?? "Error rechazando tarea" });
    }
});

adminRouter.post('/promoters', async (req: Request, res: Response): Promise<void> => {
    let promoterModel: PromoterAdmin | null = null;
    try {
        const { vc_name, vc_email, vc_password, vc_phone } = req.body;

        if (!vc_name || !vc_email || !vc_password) {
            res.status(400).json({ ok: false, error: "Nombre, email y contraseña son obligatorios" });
            return;
        }

        promoterModel = getPromoterAdmin();
        const result = await promoterModel.createPromoter({ vc_name, vc_email, vc_password, vc_phone });

        res.status(201).json({ ok: true, data: result });
    } catch (error: any) {
        console.error(error);
        res.status(500).json({ ok: false, error: error.message || "Error creando promotor" });
    } finally {
        promoterModel = null;
    }
});

// 2. OBTENER TODOS LOS PROMOTORES
adminRouter.get('/promoters', async (req: Request, res: Response): Promise<void> => {
    try {
        const promoters = await prisma.promoters.findMany({
            where: { isActive: true },
            select: { id: true, name: true, lastname: true, email: true, phone: true, dt_register: true, isActive: true, latitude: true, longitude: true },
            orderBy: { name: 'asc' },
        });
        // Se mapea a los nombres viejos (id_promoter, vc_name, b_active,
        // f_latitude, f_longitude) porque asi los consume el Dashboard en
        // el panel -- el modelo de promotores actual ya no usa ese
        // vocabulario (ahora es id/name/isActive/latitude/longitude).
        const result = promoters.map(p => ({
            id_promoter: p.id,
            vc_name: `${p.name}${p.lastname ? ' ' + p.lastname : ''}`,
            vc_email: p.email,
            vc_phone: p.phone,
            dt_register: p.dt_register,
            b_active: p.isActive,
            f_latitude: p.latitude,
            f_longitude: p.longitude,
        }))

        const u: any = (req as any).user;
        const esCliente = !!u && !u.phone && u.i_rol === 2;
        const salida = esCliente
            ? result.map(r => ({ id_promoter: r.id_promoter, vc_name: `Promotor ${r.id_promoter}`, vc_email: null, vc_phone: null, dt_register: null, b_active: r.b_active, f_latitude: r.f_latitude, f_longitude: r.f_longitude }))
            : result;
        res.status(200).json({ ok: true, data: salida });
    } catch (error) {
        console.error(error);
        res.status(500).json({ ok: false, error: "Error obteniendo promotores" });
    }
});

// 3. OBTENER UN PROMOTOR POR ID
adminRouter.get('/promoters/:id', async (req: Request, res: Response): Promise<void> => {
    let promoterModel: PromoterAdmin | null = null;
    try {
        const id = parseInt(String(req.params.id));
        if (isNaN(id)) {
            res.status(400).json({ ok: false, error: "ID inválido" });
            return;
        }

        promoterModel = getPromoterAdmin();
        const result = await promoterModel.getPromoterById(id);

        if (!result) {
            res.status(404).json({ ok: false, error: "Promotor no encontrado" });
            return;
        }

        res.status(200).json({ ok: true, data: result });
    } catch (error) {
        console.error(error);
        res.status(500).json({ ok: false, error: "Error obteniendo el promotor" });
    } finally {
        promoterModel = null;
    }
});

// 4. ACTUALIZAR PROMOTOR
adminRouter.put('/promoters/:id', async (req: Request, res: Response): Promise<void> => {
    let promoterModel: PromoterAdmin | null = null;
    try {
        const id = parseInt(String(req.params.id));
        const { vc_name, vc_phone, b_active } = req.body;

        if (isNaN(id)) {
            res.status(400).json({ ok: false, error: "ID inválido" });
            return;
        }

        promoterModel = getPromoterAdmin();
        const result = await promoterModel.updatePromoter(id, { vc_name, vc_phone, b_active });

        res.status(200).json({ ok: true, data: result });
    } catch (error) {
        console.error(error);
        res.status(500).json({ ok: false, error: "Error actualizando el promotor" });
    } finally {
        promoterModel = null;
    }
});

// 5. ELIMINAR PROMOTOR (Borrado lógico)
adminRouter.delete('/promoters/:id', async (req: Request, res: Response): Promise<void> => {
    let promoterModel: PromoterAdmin | null = null;
    try {
        const id = parseInt(String(req.params.id));
        if (isNaN(id)) {
            res.status(400).json({ ok: false, error: "ID inválido" });
            return;
        }

        promoterModel = getPromoterAdmin();
        const result = await promoterModel.deletePromoter(id);

        res.status(200).json({ ok: true, data: result });
    } catch (error) {
        console.error(error);
        res.status(500).json({ ok: false, error: "Error eliminando el promotor" });
    } finally {
        promoterModel = null;
    }
});

adminRouter.post('/promoters/login', async (req: Request, res: Response): Promise<void> => {
    let promoterModel: PromoterAdmin | null = null;
    try {
        const { vc_phone, vc_password, vc_fcm_token, f_latitude, f_longitude } = req.body;

        if (!vc_phone || !vc_password) {
            res.status(400).json({ ok: false, error: "El teléfono y la contraseña son obligatorios" });
            return;
        }

        promoterModel = new PromoterAdmin();
        const result = await promoterModel.loginPromoter(vc_phone, vc_password, vc_fcm_token || null, f_latitude ?? null, f_longitude ?? null);

        res.status(200).json({ ok: true, data: result });
    } catch (error: any) {
        console.error(error);
        res.status(401).json({ ok: false, error: error.message || "Credenciales inválidas" });
    } finally {
        promoterModel = null;
    }
});

adminRouter.get('/countries', async (req: Request, res: Response): Promise<void> => {
    let userModel: UserAdmin | null = null;
    try {
        userModel = new UserAdmin();
        const result = await userModel.getCountriesList();
        res.status(200).json({ ok: true, data: result });
    } catch (error) {
        console.error(error);
        res.status(500).json({ ok: false, error: "Error obteniendo lista de países", error_details: error instanceof Error ? error.message : String(error) });
    } finally {
        userModel = null;
    }
});

adminRouter.get('/states/:id_country', async (req: Request, res: Response): Promise<void> => {
    let userModel: UserAdmin | null = null;
    try {
        const id_country = parseInt(req.params.id_country as string);
        userModel = new UserAdmin();
        const result = await userModel.getStatesList(id_country);
        res.status(200).json({ ok: true, data: result });
    } catch (error) {
        console.error(error);
        res.status(500).json({ ok: false, error: "Error obteniendo lista de estados", error_details: error instanceof Error ? error.message : String(error) });
    } finally {
        userModel = null;
    }
});

adminRouter.get('/cities/:id_country/:id_state', async (req: Request, res: Response): Promise<void> => {
    let userModel: UserAdmin | null = null;
    try {
        const id_country = parseInt(req.params.id_country as string);
        const id_state = parseInt(req.params.id_state as string);
        userModel = new UserAdmin();
        const result = await userModel.getCitiesList(id_country, id_state);
        res.status(200).json({ ok: true, data: result });
    } catch (error) {
        console.error(error);
        res.status(500).json({ ok: false, error: "Error obteniendo lista de ciudades", error_details: error instanceof Error ? error.message : String(error) });
    } finally {
        userModel = null;
    }
});

export default adminRouter;
