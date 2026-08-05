import type { Request, Response } from 'express';
import { z } from 'zod';

import type { AdminServiceContract } from '../admin/admin.types.js';
import { AdminError } from '../admin/admin.types.js';
import type { AuthenticatedIdentity, RequestMetadata } from '../auth/auth.types.js';
import { securePasswordSchema } from '../auth/password-policy.js';

const roleSchema = z.enum(['TEACHER', 'STUDENT']);
const statusSchema = z.enum(['ACTIVE', 'INACTIVE', 'BLOCKED']);
const userIdSchema = z.string().uuid();
const listUsersSchema = z
  .object({
    role: roleSchema,
    name: z.string().trim().max(120).optional(),
    email: z.string().trim().max(254).optional(),
    status: statusSchema.optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(10).max(100).default(20),
  })
  .strict();
const createUserSchema = z
  .object({
    role: roleSchema,
    name: z.string().trim().min(3).max(120),
    email: z.string().trim().email().max(254),
    password: securePasswordSchema,
    confirmPassword: z.string().max(128),
    status: statusSchema.default('ACTIVE'),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.password !== input.confirmPassword) {
      context.addIssue({
        code: 'custom',
        path: ['confirmPassword'],
        message: 'A confirmação da senha não confere',
      });
    }
  });
const updateUserSchema = z
  .object({
    name: z.string().trim().min(3).max(120).optional(),
    email: z.string().trim().email().max(254).optional(),
  })
  .strict()
  .refine((input) => input.name !== undefined || input.email !== undefined, {
    message: 'Informe ao menos uma alteração',
  });
const updateStatusSchema = z.object({ status: statusSchema }).strict();
const resetPasswordSchema = z
  .object({
    newPassword: securePasswordSchema,
    confirmPassword: z.string().max(128),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.newPassword !== input.confirmPassword) {
      context.addIssue({
        code: 'custom',
        path: ['confirmPassword'],
        message: 'A confirmação da senha não confere',
      });
    }
  });

export function createAdminController(adminService: AdminServiceContract) {
  return {
    dashboard: async (request: Request, response: Response): Promise<void> => {
      response.status(200).json(await adminService.dashboard(requireIdentity(request)));
    },
    listUsers: async (request: Request, response: Response): Promise<void> => {
      const input = listUsersSchema.parse(request.query);
      response.status(200).json(
        await adminService.listUsers(requireIdentity(request), {
          role: input.role,
          page: input.page,
          pageSize: input.pageSize,
          ...(input.name === undefined || input.name === '' ? {} : { name: input.name }),
          ...(input.email === undefined || input.email === '' ? {} : { email: input.email }),
          ...(input.status === undefined ? {} : { status: input.status }),
        }),
      );
    },
    createUser: async (request: Request, response: Response): Promise<void> => {
      const input = createUserSchema.parse(request.body);
      response.status(201).json(
        await adminService.createUser(
          requireIdentity(request),
          {
            role: input.role,
            name: input.name,
            email: input.email,
            password: input.password,
            status: input.status,
          },
          metadata(request),
        ),
      );
    },
    updateUser: async (request: Request, response: Response): Promise<void> => {
      const userId = userIdSchema.parse(request.params.userId);
      const input = updateUserSchema.parse(request.body);
      response.status(200).json(
        await adminService.updateUser(
          requireIdentity(request),
          userId,
          {
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.email === undefined ? {} : { email: input.email }),
          },
          metadata(request),
        ),
      );
    },
    updateStatus: async (request: Request, response: Response): Promise<void> => {
      const userId = userIdSchema.parse(request.params.userId);
      const input = updateStatusSchema.parse(request.body);
      response
        .status(200)
        .json(
          await adminService.updateStatus(
            requireIdentity(request),
            userId,
            input.status,
            metadata(request),
          ),
        );
    },
    resetPassword: async (request: Request, response: Response): Promise<void> => {
      const userId = userIdSchema.parse(request.params.userId);
      const input = resetPasswordSchema.parse(request.body);
      await adminService.resetPassword(
        requireIdentity(request),
        userId,
        input.newPassword,
        metadata(request),
      );
      response.status(204).end();
    },
    deleteUser: async (request: Request, response: Response): Promise<void> => {
      const userId = userIdSchema.parse(request.params.userId);
      await adminService.deleteUser(requireIdentity(request), userId, metadata(request));
      response.status(204).end();
    },
    saveAvatar: async (request: Request, response: Response): Promise<void> => {
      const userId = userIdSchema.parse(request.params.userId);
      const file = request.file;
      if (file === undefined) {
        throw new AdminError('Selecione uma imagem', 400, 'avatar_required');
      }
      validateImageSignature(file.mimetype, file.buffer);
      await adminService.saveAvatar(
        requireIdentity(request),
        userId,
        file.mimetype,
        file.buffer,
        metadata(request),
      );
      response.status(204).end();
    },
    getAvatar: async (request: Request, response: Response): Promise<void> => {
      const userId = userIdSchema.parse(request.params.userId);
      const avatar = await adminService.getAvatar(requireIdentity(request), userId);
      response
        .status(200)
        .set({
          'Content-Type': avatar.mimeType,
          'Cache-Control': 'private, max-age=3600',
          'Content-Length': String(avatar.bytes.byteLength),
        })
        .send(Buffer.from(avatar.bytes));
    },
    deleteAvatar: async (request: Request, response: Response): Promise<void> => {
      const userId = userIdSchema.parse(request.params.userId);
      await adminService.deleteAvatar(requireIdentity(request), userId, metadata(request));
      response.status(204).end();
    },
  };
}

function requireIdentity(request: Request): AuthenticatedIdentity {
  if (request.auth === undefined) throw new Error('Identidade autenticada ausente');
  return request.auth;
}

function metadata(request: Request): RequestMetadata {
  const userAgent = request.header('user-agent');
  return {
    ...(request.ip === undefined ? {} : { ipAddress: request.ip }),
    ...(userAgent === undefined ? {} : { userAgent: userAgent.slice(0, 500) }),
  };
}

function validateImageSignature(mimeType: string, bytes: Buffer): void {
  const isJpeg =
    mimeType === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const isPng = mimeType === 'image/png' && bytes.subarray(0, 8).equals(pngMagic);
  const isWebp =
    mimeType === 'image/webp' &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  if (!isJpeg && !isPng && !isWebp) {
    throw new AdminError('Use uma imagem PNG, JPEG ou WebP válida', 400, 'invalid_avatar');
  }
}
