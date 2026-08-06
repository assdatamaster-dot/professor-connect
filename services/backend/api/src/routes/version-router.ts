import { Router } from 'express';
import { z } from 'zod';

import { VersionService } from '../version/version.service.js';
import type { VersionServiceContract } from '../version/version.types.js';

const applicationSchema = z.enum(['teacher', 'student']);
const channelSchema = z.enum(['stable', 'beta', 'development']);
const versionSchema = z
  .string()
  .trim()
  .regex(/^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
  .max(80);
const querySchema = z.object({
  application: applicationSchema.default('teacher'),
  channel: channelSchema.default('stable'),
});
const checkSchema = querySchema.extend({
  currentVersion: versionSchema,
  clientId: z.uuid().optional(),
});
const eventSchema = z.object({
  clientId: z.uuid(),
  application: applicationSchema,
  channel: channelSchema,
  event: z.string().trim().min(1).max(80),
  previousVersion: versionSchema.optional(),
  newVersion: versionSchema.optional(),
  durationMilliseconds: z.number().int().min(0).max(86_400_000).optional(),
  error: z.string().trim().max(500).optional(),
  userId: z.uuid().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export function createVersionRouter(
  service: VersionServiceContract = new VersionService(),
): Router {
  const router = Router();
  router.get('/latest', async (request, response, next) => {
    try {
      const query = querySchema.parse(request.query);
      const release = await service.latest(query.application, query.channel);
      if (release === null) {
        response
          .status(404)
          .json({ code: 'release_not_found', message: 'Nenhuma versão publicada' });
        return;
      }
      response.json(release);
    } catch (error) {
      next(error);
    }
  });
  router.get('/check', async (request, response, next) => {
    try {
      response.json(await service.check(checkSchema.parse(request.query)));
    } catch (error) {
      next(error);
    }
  });
  router.post('/events', async (request, response, next) => {
    try {
      await service.recordEvent(eventSchema.parse(request.body));
      response.status(202).json({ accepted: true });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
