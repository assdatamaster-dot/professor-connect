import type { Request, Response } from 'express';
import { z } from 'zod';

import { securePasswordSchema } from '../auth/password-policy.js';
import type { RequestMetadata } from '../auth/auth.types.js';
import {
  BootstrapError,
  type BootstrapImage,
  type BootstrapServiceContract,
} from '../bootstrap/bootstrap.types.js';

const optionalText = (maximum: number) =>
  z.string().trim().max(maximum).optional().or(z.literal(''));
const setupSchema = z
  .object({
    organization: z
      .object({
        name: z.string().trim().min(2).max(120),
        tradeName: optionalText(120),
        taxId: optionalText(18),
        slug: z
          .string()
          .trim()
          .min(2)
          .max(100)
          .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Identificador da instituição inválido'),
        city: z.string().trim().min(2).max(100),
        state: z.string().trim().min(2).max(50),
        country: z.string().trim().min(2).max(80),
        timezone: z.string().trim().min(1).max(100),
        language: z.string().trim().min(2).max(20),
      })
      .strict(),
    administrator: z
      .object({
        firstName: z.string().trim().min(2).max(60),
        lastName: z.string().trim().min(2).max(60),
        email: z.string().trim().email().max(254),
        password: securePasswordSchema,
        confirmPassword: z.string().max(128),
        phone: optionalText(30),
      })
      .strict(),
    settings: z
      .object({
        systemName: z.string().trim().min(2).max(120),
        theme: z.enum(['light', 'dark', 'system']),
        language: z.string().trim().min(2).max(20),
        defaults: z
          .object({
            sessionDurationMinutes: z.number().int().min(15).max(480),
            allowSelfRegistration: z.boolean(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.administrator.password !== input.administrator.confirmPassword) {
      context.addIssue({
        code: 'custom',
        path: ['administrator', 'confirmPassword'],
        message: 'A confirmação da senha não confere',
      });
    }
    const taxId = input.organization.taxId?.replace(/\D/g, '') ?? '';
    if (taxId !== '' && taxId.length !== 14) {
      context.addIssue({
        code: 'custom',
        path: ['organization', 'taxId'],
        message: 'Informe um CNPJ com 14 dígitos',
      });
    }
  });
const sessionSchema = z
  .object({
    email: z.string().trim().email().max(254),
    password: z.string().min(1).max(1024),
  })
  .strict();

export function createBootstrapController(service: BootstrapServiceContract) {
  return {
    status: async (_request: Request, response: Response): Promise<void> => {
      response
        .set('Cache-Control', 'no-store')
        .status(200)
        .json(await service.initialize());
    },
    setup: async (request: Request, response: Response): Promise<void> => {
      const input = setupSchema.parse(parsePayload(request));
      const files = (request.files ?? {}) as Record<string, Express.Multer.File[]>;
      const avatar = image(files.adminAvatar?.[0]);
      const logo = image(files.logo?.[0]);
      response
        .set('Cache-Control', 'no-store')
        .status(201)
        .json(
          await service.setup(
            {
              organization: {
                name: input.organization.name,
                slug: input.organization.slug,
                city: input.organization.city,
                state: input.organization.state,
                country: input.organization.country,
                timezone: input.organization.timezone,
                language: input.organization.language,
                ...(input.organization.tradeName === undefined ||
                input.organization.tradeName === ''
                  ? {}
                  : { tradeName: input.organization.tradeName }),
                ...(input.organization.taxId === undefined || input.organization.taxId === ''
                  ? {}
                  : { taxId: input.organization.taxId }),
              },
              administrator: {
                firstName: input.administrator.firstName,
                lastName: input.administrator.lastName,
                email: input.administrator.email,
                password: input.administrator.password,
                ...(input.administrator.phone === undefined || input.administrator.phone === ''
                  ? {}
                  : { phone: input.administrator.phone }),
                ...(avatar === undefined ? {} : { avatar }),
              },
              settings: {
                ...input.settings,
                ...(logo === undefined ? {} : { logo }),
              },
            },
            metadata(request),
          ),
        );
    },
    session: async (request: Request, response: Response): Promise<void> => {
      const input = sessionSchema.parse(request.body);
      response
        .set('Cache-Control', 'no-store')
        .status(200)
        .json(await service.recoverSession(input.email, input.password, metadata(request)));
    },
  };
}

function parsePayload(request: Request): unknown {
  if (typeof request.body?.payload !== 'string') return request.body;
  try {
    return JSON.parse(request.body.payload) as unknown;
  } catch {
    throw new BootstrapError('Dados de configuração inválidos', 400, 'invalid_bootstrap_payload');
  }
}

function image(file: Express.Multer.File | undefined): BootstrapImage | undefined {
  if (file === undefined) return undefined;
  validateImageSignature(file.mimetype, file.buffer);
  return { mimeType: file.mimetype, bytes: new Uint8Array(file.buffer) };
}

function validateImageSignature(mimeType: string, bytes: Uint8Array): void {
  const valid =
    (mimeType === 'image/png' &&
      bytes.length >= 8 &&
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
        (value, index) => bytes[index] === value,
      )) ||
    (mimeType === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8) ||
    (mimeType === 'image/webp' &&
      Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'RIFF' &&
      Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WEBP');
  if (!valid) {
    throw new BootstrapError('Imagem inválida. Use PNG, JPEG ou WebP.', 400, 'invalid_image');
  }
}

function metadata(request: Request): RequestMetadata {
  const userAgent = request.header('user-agent');
  return {
    ...(request.ip === undefined ? {} : { ipAddress: request.ip }),
    ...(userAgent === undefined ? {} : { userAgent: userAgent.slice(0, 500) }),
  };
}
