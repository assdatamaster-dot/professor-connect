import type { Request, Response } from 'express';
import { z } from 'zod';

import type { AuthServiceContract, RequestMetadata } from '../auth/auth.types.js';
import { securePasswordSchema } from '../auth/password-policy.js';

const registerSchema = z
  .object({
    name: z.string().trim().min(3).max(120),
    email: z.string().trim().email().max(254),
    password: securePasswordSchema,
    confirmPassword: z.string().max(128),
    role: z.enum(['TEACHER', 'STUDENT', 'PROFESSOR', 'ALUNO']),
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

const loginSchema = z
  .object({
    email: z.string().email().max(254),
    password: z.string().min(1).max(1024),
    organizationSlug: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9-]+$/)
      .optional(),
  })
  .strict();
const onboardingSchema = z
  .object({
    organizationName: z.string().trim().min(2).max(120),
    organizationSlug: z
      .string()
      .trim()
      .min(2)
      .max(100)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Identificador da instituição inválido'),
    name: z.string().trim().min(3).max(120),
    email: z.string().trim().email().max(254),
    password: securePasswordSchema,
    confirmPassword: z.string().max(128),
    setupKey: z.string().min(32).max(1024),
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
const refreshSchema = z.object({ refreshToken: z.string().min(20).max(8192) }).strict();
const passwordSchema = z
  .object({
    currentPassword: z.string().min(1).max(1024),
    newPassword: securePasswordSchema,
  })
  .strict();

export function createAuthController(authService: AuthServiceContract) {
  return {
    register: async (request: Request, response: Response): Promise<void> => {
      const input = registerSchema.parse(request.body);
      response.status(201).json(
        await authService.register(
          {
            name: input.name,
            email: input.email,
            password: input.password,
            role: input.role === 'TEACHER' || input.role === 'PROFESSOR' ? 'TEACHER' : 'STUDENT',
          },
          metadata(request),
        ),
      );
    },
    onboardOrganization: async (request: Request, response: Response): Promise<void> => {
      const input = onboardingSchema.parse(request.body);
      response.status(201).json(
        await authService.onboardOrganization(
          {
            organizationName: input.organizationName,
            organizationSlug: input.organizationSlug,
            name: input.name,
            email: input.email,
            password: input.password,
            setupKey: input.setupKey,
          },
          metadata(request),
        ),
      );
    },
    login: async (request: Request, response: Response): Promise<void> => {
      const input = loginSchema.parse(request.body);
      const result = await authService.login(
        input.email,
        input.password,
        input.organizationSlug,
        metadata(request),
      );
      response.status(200).json(result);
    },
    refresh: async (request: Request, response: Response): Promise<void> => {
      const input = refreshSchema.parse(request.body);
      response.status(200).json(await authService.refresh(input.refreshToken, metadata(request)));
    },
    me: (request: Request, response: Response): void => {
      response.json({ identity: request.auth });
    },
    logout: async (request: Request, response: Response): Promise<void> => {
      await authService.logout(requireIdentity(request));
      response.status(204).end();
    },
    logoutAll: async (request: Request, response: Response): Promise<void> => {
      await authService.logoutAll(requireIdentity(request));
      response.status(204).end();
    },
    sessions: async (request: Request, response: Response): Promise<void> => {
      response.json({ sessions: await authService.listSessions(requireIdentity(request)) });
    },
    revokeSession: async (request: Request, response: Response): Promise<void> => {
      const familyId = z.string().uuid().parse(request.params.familyId);
      await authService.revokeSession(requireIdentity(request), familyId);
      response.status(204).end();
    },
    changePassword: async (request: Request, response: Response): Promise<void> => {
      const input = passwordSchema.parse(request.body);
      await authService.changePassword(
        requireIdentity(request),
        input.currentPassword,
        input.newPassword,
      );
      response.status(204).end();
    },
    providers: (_request: Request, response: Response): void => {
      response.json({
        providers: [
          { id: 'password', enabled: true },
          { id: 'google', enabled: false },
          { id: 'microsoft', enabled: false },
          { id: 'ldap', enabled: false },
        ],
      });
    },
  };
}

function requireIdentity(request: Request) {
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
