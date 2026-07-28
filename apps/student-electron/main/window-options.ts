import type { BrowserWindowConstructorOptions } from 'electron';

export function createWindowOptions(
  preloadPath: string,
  iconPath?: string,
): BrowserWindowConstructorOptions {
  return {
    width: 1180,
    height: 780,
    minWidth: 760,
    minHeight: 620,
    show: false,
    title: 'Professor Connect',
    ...(iconPath === undefined ? {} : { icon: iconPath }),
    backgroundColor: '#f5f7fb',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };
}
