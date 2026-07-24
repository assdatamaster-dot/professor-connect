type LogLevel = 'error' | 'info';
type LogContext = Readonly<Record<string, unknown>>;

function writeLog(level: LogLevel, event: string, data: LogContext = {}): void {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    origin: 'backend',
    event,
    data,
  });

  if (level === 'error') {
    console.error(entry);
    return;
  }

  console.info(entry);
}

export const logger = {
  info(event: string, data?: LogContext): void {
    writeLog('info', event, data);
  },
  error(event: string, error: unknown): void {
    const errorContext =
      error instanceof Error
        ? { errorName: error.name, errorMessage: error.message }
        : { errorName: 'UnknownError' };

    writeLog('error', event, errorContext);
  },
};
