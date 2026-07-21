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
}

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
  nodeEnv: parseNodeEnvironment(process.env.NODE_ENV),
  port: parsePort(process.env.PORT),
  requestTimeoutMs: parsePositiveInteger(
    process.env.REQUEST_TIMEOUT_MS,
    DEFAULT_REQUEST_TIMEOUT_MS,
    'REQUEST_TIMEOUT_MS',
  ),
  heartbeatIntervalMs,
  heartbeatTimeoutMs,
  reconnectWindowMs,
});
