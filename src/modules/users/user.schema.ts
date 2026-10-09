import { z } from 'zod';

export const createUserSchema = z.object({
  email: z.string().email('email debe ser válido'),
  name: z.string().min(1, 'name es requerido'),
  lastname: z.string().min(1, 'lastname es requerido'),
  password: z.string().min(6, 'password debe tener al menos 6 caracteres'),
  i_rol: z.number().int().optional(),
  i_status: z.number().int().optional(),
  id_client: z.number().int().positive('id_client es requerido'),
});

export const userIdParamSchema = z.object({
  id_client: z.string().regex(/^\d+$/, 'id_client debe ser un número').transform(Number),
});

export const createClientUserSchema = z.object({
  name: z.string().min(1, 'name es requerido'),
  lastname: z.string().min(1, 'lastname es requerido'),
  phone: z.string().regex(/^\d{10}$/, 'El celular debe tener 10 dígitos'),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres'),
});
