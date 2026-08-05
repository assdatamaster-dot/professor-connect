const ELECTRON_REMOTE_ERROR_PREFIX = /^Error invoking remote method '[^']+': Error:\s*/;

export function toUserFacingErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const message = error.message.replace(ELECTRON_REMOTE_ERROR_PREFIX, '').trim();
  return message.length === 0 ? fallback : message;
}
