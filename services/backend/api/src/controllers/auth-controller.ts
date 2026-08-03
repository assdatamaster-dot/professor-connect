import type { Request, Response } from 'express';
import { z } from 'zod';

import type { AuthServiceContract, RequestMetadata } from '../auth/auth.types.js';

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
const refreshSchema = z.object({ refreshToken: z.string().min(20).max(8192) }).strict();
const passwordSchema = z
  .object({
    currentPassword: z.string().min(1).max(1024),
    newPassword: z
      .string()
      .min(12)
      .max(128)
      .regex(/[a-z]/, 'A nova senha deve conter letra minúscula')
      .regex(/[A-Z]/, 'A nova senha deve conter letra maiúscula')
      .regex(/[0-9]/, 'A nova senha deve conter número')
      .regex(/[^A-Za-z0-9]/, 'A nova senha deve conter símbolo'),
  })
  .strict();

export function createAuthController(authService: AuthServiceContract) {
  return {
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
