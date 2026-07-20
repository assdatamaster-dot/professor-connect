import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

const configDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryEnvironmentPath = resolve(configDirectory, '../../../.env');

dotenv.config({ path: repositoryEnvironmentPath, quiet: true });

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = '0.0.0.0';
const VALID_NODE_ENVIRONMENTS = ['development', 'test', 'production'] as const;

type NodeEnvironment = (typeof VALID_NODE_ENVIRONMENTS)[number];

export interface Environment {
  readonly host: string;
  readonly nodeEnv: NodeEnvironment;
  readonly port: number;
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

export const environment: Environment = Object.freeze({
  host: process.env.HOST ?? DEFAULT_HOST,
  nodeEnv: parseNodeEnvironment(process.env.NODE_ENV),
  port: parsePort(process.env.PORT),
});
