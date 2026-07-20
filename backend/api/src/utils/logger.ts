type LogLevel = 'error' | 'info';
type LogContext = Readonly<Record<string, unknown>>;

function writeLog(level: LogLevel, message: string, context?: LogContext): void {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(context === undefined ? {} : { context }),
  });

  if (level === 'error') {
    console.error(entry);
    return;
  }

  console.info(entry);
}

export const logger = {
  info(message: string, context?: LogContext): void {
    writeLog('info', message, context);
  },
  error(message: string, error: unknown): void {
    const errorContext =
      error instanceof Error
        ? { errorName: error.name, errorMessage: error.message }
        : { errorName: 'UnknownError' };

    writeLog('error', message, errorContext);
  },
};
