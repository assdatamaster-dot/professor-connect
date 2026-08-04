import type { Request, Response } from 'express';
import { z } from 'zod';

import type { AuthServiceContract } from '../auth/auth.types.js';
import { securePasswordSchema } from '../auth/password-policy.js';

const updateProfileSchema = z
  .object({
    name: z.string().trim().min(3).max(120).optional(),
    avatar: z
      .union([
        z
          .string()
          .trim()
          .url()
          .max(2048)
          .refine((value) => new URL(value).protocol === 'https:', 'A foto deve usar HTTPS'),
        z.literal(''),
        z.null(),
      ])
      .optional(),
    currentPassword: z.string().min(1).max(1024).optional(),
    password: securePasswordSchema.optional(),
    confirmPassword: z.string().max(128).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (Object.values(input).every((value) => value === undefined)) {
      context.addIssue({ code: 'custom', message: 'Informe ao menos uma alteração' });
    }
    if (input.password !== undefined && input.password !== input.confirmPassword) {
      context.addIssue({
        code: 'custom',
        path: ['confirmPassword'],
        message: 'A confirmação da senha não confere',
      });
    }
    if (input.password !== undefined && input.currentPassword === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['currentPassword'],
        message: 'Informe a senha atual',
      });
    }
    if (input.password === undefined && input.currentPassword !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['password'],
        message: 'Informe a nova senha',
      });
    }
  });

export function createUsersController(authService: AuthServiceContract) {
  return {
    me: async (request: Request, response: Response): Promise<void> => {
      response.status(200).json(await authService.getProfile(requireIdentity(request)));
    },
    updateMe: async (request: Request, response: Response): Promise<void> => {
      const input = updateProfileSchema.parse(request.body);
      response.status(200).json(
        await authService.updateProfile(requireIdentity(request), {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.avatar === undefined
            ? {}
            : { avatar: input.avatar === '' ? null : input.avatar }),
          ...(input.currentPassword === undefined
            ? {}
            : { currentPassword: input.currentPassword }),
          ...(input.password === undefined ? {} : { password: input.password }),
        }),
      );
    },
  };
}

function requireIdentity(request: Request) {
  if (request.auth === undefined) throw new Error('Identidade autenticada ausente');
  return request.auth;
}
