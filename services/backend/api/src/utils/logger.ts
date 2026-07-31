type LogLevel = 'error' | 'info';
type LogContext = Readonly<Record<string, unknown>>;

export interface LogPersistence {
  recordApplicationLog(level: LogLevel, event: string, context?: LogContext): void;
}

function writeLog(
  level: LogLevel,
  event: string,
  data: LogContext = {},
  persistence?: LogPersistence,
): void {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    origin: 'backend',
    event,
    data,
  });

  if (level === 'error') {
    console.error(entry);
    persistence?.recordApplicationLog(level, event, data);
    return;
  }

  console.info(entry);
  persistence?.recordApplicationLog(level, event, data);
}

export function createLogger(persistence?: LogPersistence) {
  return {
    info(event: string, data?: LogContext): void {
      writeLog('info', event, data, persistence);
    },
    error(event: string, error: unknown): void {
      const errorContext =
        error instanceof Error
          ? { errorName: error.name, errorMessage: error.message }
          : { errorName: 'UnknownError' };

      writeLog('error', event, errorContext, persistence);
    },
  };
}

export const logger = createLogger();
