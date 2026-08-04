import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';

import type {
  DesktopAuthClient,
  DesktopCredentials,
  DesktopProfileUpdate,
  DesktopRegistration,
  StoredAuthSession,
} from './index.js';

export interface DesktopAuthChannels {
  readonly login: string;
  readonly register: string;
  readonly logout: string;
  readonly getIdentity: string;
  readonly getProfile: string;
  readonly updateProfile: string;
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
  ipcMain.handle(channels.register, async (event, value: unknown) => {
    assertSender(event);
    const registration = requireRegistration(value, options.requiredRole);
    const identity = await client.register(registration);
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
  ipcMain.handle(channels.getProfile, (event) => {
    assertSender(event);
    return client.getProfile();
  });
  ipcMain.handle(channels.updateProfile, async (event, value: unknown) => {
    assertSender(event);
    const update = requireProfileUpdate(value);
    const profile = await client.updateProfile(update);
    if (update.password !== undefined) options.beforeLogout?.();
    return profile;
  });
  return {
    dispose(): void {
      ipcMain.removeHandler(channels.login);
      ipcMain.removeHandler(channels.register);
      ipcMain.removeHandler(channels.logout);
      ipcMain.removeHandler(channels.getIdentity);
      ipcMain.removeHandler(channels.getProfile);
      ipcMain.removeHandler(channels.updateProfile);
    },
  };
}

function requireRegistration(
  value: unknown,
  role: DesktopRegistration['role'],
): DesktopRegistration {
  if (typeof value !== 'object' || value === null) throw new Error('Dados de cadastro inválidos');
  const record = value as Record<string, unknown>;
  if (
    typeof record.name !== 'string' ||
    typeof record.email !== 'string' ||
    typeof record.password !== 'string' ||
    typeof record.confirmPassword !== 'string' ||
    record.name.trim().length > 120 ||
    record.email.length > 254 ||
    record.password.length > 128 ||
    record.confirmPassword.length > 128
  ) {
    throw new Error('Dados de cadastro inválidos');
  }
  return {
    name: record.name.trim(),
    email: record.email.trim(),
    password: record.password,
    confirmPassword: record.confirmPassword,
    role,
  };
}

function requireProfileUpdate(value: unknown): DesktopProfileUpdate {
  if (typeof value !== 'object' || value === null) throw new Error('Perfil inválido');
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!['name', 'avatar', 'currentPassword', 'password', 'confirmPassword'].includes(key)) {
      throw new Error('Campo de perfil não permitido');
    }
  }
  if (
    (record.name !== undefined && typeof record.name !== 'string') ||
    (record.avatar !== undefined && record.avatar !== null && typeof record.avatar !== 'string') ||
    (record.currentPassword !== undefined && typeof record.currentPassword !== 'string') ||
    (record.password !== undefined && typeof record.password !== 'string') ||
    (record.confirmPassword !== undefined && typeof record.confirmPassword !== 'string')
  ) {
    throw new Error('Perfil inválido');
  }
  return {
    ...(typeof record.name === 'string' ? { name: record.name.trim() } : {}),
    ...(typeof record.avatar === 'string' || record.avatar === null
      ? { avatar: record.avatar }
      : {}),
    ...(typeof record.currentPassword === 'string'
      ? { currentPassword: record.currentPassword }
      : {}),
    ...(typeof record.password === 'string' ? { password: record.password } : {}),
    ...(typeof record.confirmPassword === 'string'
      ? { confirmPassword: record.confirmPassword }
      : {}),
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
