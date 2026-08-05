import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

const configDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryEnvironmentPath = resolve(configDirectory, '../../../../.env');

dotenv.config({ path: repositoryEnvironmentPath, quiet: true });

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 90_000;
const DEFAULT_RECONNECT_WINDOW_MS = 90_000;
const VALID_NODE_ENVIRONMENTS = ['development', 'test', 'production'] as const;

type NodeEnvironment = (typeof VALID_NODE_ENVIRONMENTS)[number];

export interface Environment {
  readonly host: string;
  readonly nodeEnv: NodeEnvironment;
  readonly port: number;
  readonly requestTimeoutMs: number;
  readonly heartbeatIntervalMs: number;
  readonly heartbeatTimeoutMs: number;
  readonly reconnectWindowMs: number;
  readonly corsOrigins: readonly string[];
  readonly jwtAccessSecret: string;
  readonly jwtRefreshSecret: string;
  readonly jwtIssuer: string;
  readonly jwtAudience: string;
  readonly accessTokenTtlSeconds: number;
  readonly refreshTokenTtlSeconds: number;
  readonly bcryptRounds: number;
  readonly adminOnboardingKey: string | undefined;
  readonly trustProxy: boolean;
}

const DEVELOPMENT_ACCESS_SECRET = 'development-access-secret-change-before-production';
const DEVELOPMENT_REFRESH_SECRET = 'development-refresh-secret-change-before-production';

function requireSecret(value: string | undefined, name: string, nodeEnv: NodeEnvironment): string {
  const secret =
    value ??
    (name === 'JWT_ACCESS_SECRET' ? DEVELOPMENT_ACCESS_SECRET : DEVELOPMENT_REFRESH_SECRET);
  if (nodeEnv === 'production' && value === undefined) {
    throw new Error(`${name} é obrigatório em produção`);
  }
  if (secret.length < 32) {
    throw new Error(`${name} deve possuir ao menos 32 caracteres`);
  }
  return secret;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error('Valor booleano inválido');
}

const nodeEnv = parseNodeEnvironment(process.env.NODE_ENV);

function isNodeEnvironment(value: string): value is NodeEnvironment {
  return VALID_NODE_ENVIRONMENTS.some((candidate) => candidate === value);
}

function parseNodeEnvironment(value: string | undefined): NodeEnvironment {
  const nodeEnvironment = value ?? 'development';

  if (!isNodeEnvironment(nodeEnvironment)) {
    throw new Error(`NODE_ENV inválido: ${nodeEnvironment}`);
  }

  return nodeEnvironment;
}

function parsePort(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_PORT;
  }

  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT deve ser um número inteiro entre 1 e 65535');
  }

  return port;
}

function parsePositiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) {
    return fallback;
  }

  const timeout = Number(value);

  if (!Number.isInteger(timeout) || timeout <= 0) {
    throw new Error(`${name} deve ser um número inteiro positivo`);
  }

  return timeout;
}

const heartbeatIntervalMs = parsePositiveInteger(
  process.env.HEARTBEAT_INTERVAL_MS,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  'HEARTBEAT_INTERVAL_MS',
);
const heartbeatTimeoutMs = parsePositiveInteger(
  process.env.HEARTBEAT_TIMEOUT_MS,
  DEFAULT_HEARTBEAT_TIMEOUT_MS,
  'HEARTBEAT_TIMEOUT_MS',
);
const reconnectWindowMs = parsePositiveInteger(
  process.env.RECONNECT_WINDOW_MS,
  DEFAULT_RECONNECT_WINDOW_MS,
  'RECONNECT_WINDOW_MS',
);

if (heartbeatIntervalMs >= heartbeatTimeoutMs) {
  throw new Error('HEARTBEAT_INTERVAL_MS deve ser menor que HEARTBEAT_TIMEOUT_MS');
}

if (reconnectWindowMs > heartbeatTimeoutMs) {
  throw new Error('RECONNECT_WINDOW_MS não pode exceder HEARTBEAT_TIMEOUT_MS');
}

export const environment: Environment = Object.freeze({
  host: process.env.HOST ?? DEFAULT_HOST,
  nodeEnv,
  port: parsePort(process.env.PORT),
  requestTimeoutMs: parsePositiveInteger(
    process.env.REQUEST_TIMEOUT_MS,
    DEFAULT_REQUEST_TIMEOUT_MS,
    'REQUEST_TIMEOUT_MS',
  ),
  heartbeatIntervalMs,
  heartbeatTimeoutMs,
  reconnectWindowMs,
  corsOrigins: Object.freeze(
    (process.env.CORS_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  ),
  jwtAccessSecret: requireSecret(process.env.JWT_ACCESS_SECRET, 'JWT_ACCESS_SECRET', nodeEnv),
  jwtRefreshSecret: requireSecret(process.env.JWT_REFRESH_SECRET, 'JWT_REFRESH_SECRET', nodeEnv),
  jwtIssuer: process.env.JWT_ISSUER ?? 'professor-connect',
  jwtAudience: process.env.JWT_AUDIENCE ?? 'professor-connect-clients',
  accessTokenTtlSeconds: parsePositiveInteger(
    process.env.ACCESS_TOKEN_TTL_SECONDS,
    900,
    'ACCESS_TOKEN_TTL_SECONDS',
  ),
  refreshTokenTtlSeconds: parsePositiveInteger(
    process.env.REFRESH_TOKEN_TTL_SECONDS,
    2_592_000,
    'REFRESH_TOKEN_TTL_SECONDS',
  ),
  bcryptRounds: parsePositiveInteger(process.env.BCRYPT_ROUNDS, 12, 'BCRYPT_ROUNDS'),
  adminOnboardingKey: parseOptionalSecret(process.env.ADMIN_ONBOARDING_KEY, 'ADMIN_ONBOARDING_KEY'),
  trustProxy: parseBoolean(process.env.TRUST_PROXY, false),
});

function parseOptionalSecret(value: string | undefined, name: string): string | undefined {
  if (value === undefined || value.trim().length === 0) return undefined;
  if (value.length < 32) throw new Error(`${name} deve possuir ao menos 32 caracteres`);
  return value;
}
