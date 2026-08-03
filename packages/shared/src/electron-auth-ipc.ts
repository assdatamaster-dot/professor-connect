import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';

import type { DesktopAuthClient, DesktopCredentials, StoredAuthSession } from './index.js';

export interface DesktopAuthChannels {
  readonly login: string;
  readonly logout: string;
  readonly getIdentity: string;
}

export function registerDesktopAuthIpc(
  client: DesktopAuthClient,
  renderer: WebContents,
  channels: DesktopAuthChannels,
  options: {
    readonly requiredRole: 'TEACHER' | 'STUDENT';
    readonly afterLogin?: (identity: StoredAuthSession['identity']) => Promise<void>;
    readonly beforeLogout?: () => void;
  },
): { dispose(): void } {
  const assertSender = (event: IpcMainInvokeEvent): void => {
    if (event.sender.id !== renderer.id) throw new Error('Origem IPC não autorizada');
  };
  ipcMain.handle(channels.login, async (event, value: unknown) => {
    assertSender(event);
    const credentials = requireCredentials(value);
    const identity = await client.login(
      credentials.email,
      credentials.password,
      credentials.organizationSlug,
    );
    if (!identity.roles.includes(options.requiredRole)) {
      await client.logout();
      throw new Error('Perfil sem acesso a este aplicativo');
    }
    await options.afterLogin?.(identity);
    return identity;
  });
  ipcMain.handle(channels.logout, async (event) => {
    assertSender(event);
    options.beforeLogout?.();
    await client.logout();
  });
  ipcMain.handle(channels.getIdentity, (event) => {
    assertSender(event);
    return client.getIdentity();
  });
  return {
    dispose(): void {
      ipcMain.removeHandler(channels.login);
      ipcMain.removeHandler(channels.logout);
      ipcMain.removeHandler(channels.getIdentity);
    },
  };
}

function requireCredentials(value: unknown): DesktopCredentials {
  if (typeof value !== 'object' || value === null) throw new Error('Credenciais inválidas');
  const record = value as Record<string, unknown>;
  if (
    typeof record.email !== 'string' ||
    typeof record.password !== 'string' ||
    record.email.length > 254 ||
    record.password.length > 1024
  )
    throw new Error('Credenciais inválidas');
  return {
    email: record.email.trim(),
    password: record.password,
    ...(typeof record.organizationSlug === 'string' && record.organizationSlug.trim().length > 0
      ? { organizationSlug: record.organizationSlug.trim() }
      : {}),
  };
}
