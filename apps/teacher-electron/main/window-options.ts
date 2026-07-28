import type { BrowserWindowConstructorOptions } from 'electron';

export function createWindowOptions(
  preloadPath: string,
  iconPath?: string,
): BrowserWindowConstructorOptions {
  return {
    width: 1320,
    height: 840,
    minWidth: 860,
    minHeight: 640,
    show: false,
    title: 'Professor Connect',
    ...(iconPath === undefined ? {} : { icon: iconPath }),
    backgroundColor: '#f4f7fb',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };
}
