export type StructuredLogLevel = 'error' | 'info';
export type StructuredLogData = Readonly<Record<string, unknown>>;

export interface StructuredLogger {
  info(event: string, data?: StructuredLogData): void;
  error(event: string, error?: unknown): void;
}

export function createStructuredLogger(origin: string): StructuredLogger {
  return {
    info(event, data): void {
      writeStructuredLog('info', origin, event, data);
    },
    error(event, error): void {
      writeStructuredLog('error', origin, event, serializeError(error));
    },
  };
}

function writeStructuredLog(
  level: StructuredLogLevel,
  origin: string,
  event: string,
  data: StructuredLogData = {},
): void {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    origin,
    event,
    data,
  });
  if (level === 'error') {
    console.error(entry);
    return;
  }
  console.info(entry);
}

function serializeError(error: unknown): StructuredLogData {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
    };
  }
  if (error === undefined) {
    return {};
  }
  return { errorName: 'UnknownError', errorValue: String(error) };
}
