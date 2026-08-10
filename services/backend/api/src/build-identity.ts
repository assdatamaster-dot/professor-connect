import { createRequire } from 'node:module';

import { environment } from '@professor-connect/config';

import type { HealthResponse } from './types/health-response.js';

const require = createRequire(import.meta.url);
const packageMetadata = require('../package.json') as { readonly version: string };

export function getBackendBuildIdentity(): Omit<HealthResponse, 'status'> {
  return {
    version: packageMetadata.version,
    gitSha: normalizeGitSha(process.env.APP_GIT_SHA),
    buildDate: normalizeBuildDate(process.env.APP_BUILD_DATE),
    environment: environment.nodeEnv,
  };
}

function normalizeGitSha(value: string | undefined): string {
  return value !== undefined && /^[0-9a-f]{7,40}$/i.test(value) ? value : 'unknown';
}

function normalizeBuildDate(value: string | undefined): string {
  return value !== undefined && !Number.isNaN(Date.parse(value))
    ? new Date(value).toISOString()
    : 'unknown';
}
