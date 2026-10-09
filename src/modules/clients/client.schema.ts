import { z } from 'zod';

export const createClientSchema = z.object({
  id_user: z.number().int().positive('id_user es requerido'),
  name: z.string().min(1, 'name es requerido'),
  rfc: z.string().optional(),
  email: z.string().email('email debe ser válido').nullable().optional().or(z.literal('')),
  phone: z.string().optional(),
  id_pais: z.number().int().positive().optional(),
  id_estado: z.number().int().positive().optional(),
  id_ciudad: z.number().int().positive().optional(),
  street: z.string().optional(),
  ext_number: z.string().optional(),
  int_number: z.string().optional(),
  neighborhood: z.string().optional(),
  zip: z.string().optional(),
  addiccional_notes: z.string().optional(),
  owner_name: z.string().optional(),
  owner_lastname: z.string().optional(),
  owner_phone: z.string().regex(/^\d{10}$/, 'El celular del dueño debe tener 10 dígitos').optional().or(z.literal('')),
  owner_password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres').optional().or(z.literal('')),
});

export const clientIdParamSchema = z.object({
  id_client: z.string().regex(/^\d+$/, 'id_client debe ser un número').transform(Number),
});
