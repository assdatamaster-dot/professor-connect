import {
  app,
  BrowserWindow,
  desktopCapturer,
  Menu,
  session,
  webContents,
  type DesktopCapturerSource,
  type MenuItemConstructorOptions,
} from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { registerDesktopIpc, type DesktopIpcRegistration } from './ipc.js';
import { StudentPresenceController } from './student-presence.controller.js';
import { registerSessionIpc, type SessionIpcRegistration } from './session-ipc.js';
import { StudentWorkflowController } from './student-workflow.controller.js';
import { createWindowOptions } from './window-options.js';
import {
  createDesktopWorkflowManager,
  DEFAULT_STUDENT_WORKFLOW_INPUT,
} from './workflow-composition.js';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | undefined;
let ipcRegistration: DesktopIpcRegistration | undefined;
let presenceController: StudentPresenceController | undefined;
let sessionIpcRegistration: SessionIpcRegistration | undefined;
let workflowController: StudentWorkflowController | undefined;

async function createMainWindow(): Promise<void> {
  const preloadPath = path.join(currentDirectory, '..', 'preload', 'index.js');
  const rendererPath = path.join(currentDirectory, '..', 'renderer', 'index.html');
  const configPath = path.join(currentDirectory, '..', 'config.json');
  const manager = createDesktopWorkflowManager();

  workflowController = new StudentWorkflowController(manager, {
    startInput: DEFAULT_STUDENT_WORKFLOW_INPUT,
  });
  mainWindow = new BrowserWindow(createWindowOptions(preloadPath));
  ipcRegistration = registerDesktopIpc(workflowController, mainWindow.webContents);
  presenceController = new StudentPresenceController(configPath);
  sessionIpcRegistration = registerSessionIpc(presenceController, mainWindow.webContents);

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    ipcRegistration?.dispose();
    presenceController?.dispose();
    sessionIpcRegistration?.dispose();
    workflowController?.dispose();
    ipcRegistration = undefined;
    presenceController = undefined;
    sessionIpcRegistration = undefined;
    workflowController = undefined;
    mainWindow = undefined;
  });

  await mainWindow.loadFile(rendererPath);
  void presenceController.connect().catch((error: unknown) => {
    console.error('[student-presence] Não foi possível conectar ao servidor', error);
  });
}

function registerDisplayMediaRequestHandler(): void {
  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      const window = mainWindow;
      const requestingWebContents =
        request.frame === null ? undefined : webContents.fromFrame(request.frame);

      if (
        window === undefined ||
        window.isDestroyed() ||
        requestingWebContents?.id !== window.webContents.id ||
        !request.videoRequested ||
        !request.userGesture
      ) {
        callback({});
        return;
      }

      void desktopCapturer
        .getSources({
          types: ['screen', 'window'],
          thumbnailSize: { width: 0, height: 0 },
          fetchWindowIcons: false,
        })
        .then((sources) => {
          if (window.isDestroyed()) {
            callback({});
            return;
          }

          showDisplayMediaSourceMenu(window, sources, callback);
        })
        .catch((error: unknown) => {
          console.error('[screen-share] Não foi possível listar telas e janelas', error);
          callback({});
        });
    },
    { useSystemPicker: true },
  );
}

function showDisplayMediaSourceMenu(
  window: BrowserWindow,
  sources: DesktopCapturerSource[],
  callback: (streams: Electron.Streams) => void,
): void {
  let requestCompleted = false;
  const completeRequest = (source?: DesktopCapturerSource): void => {
    if (requestCompleted) {
      return;
    }
    requestCompleted = true;
    callback(source === undefined ? {} : { video: source });
  };

  const screens = sources.filter((source) => source.id.startsWith('screen:'));
  const windows = sources.filter((source) => source.id.startsWith('window:'));
  const sections = [
    { title: 'Telas', sources: screens },
    { title: 'Janelas', sources: windows },
  ].filter((section) => section.sources.length > 0);
  const template: MenuItemConstructorOptions[] = sections.flatMap((section, index) => [
    ...(index === 0 ? [] : [{ type: 'separator' as const }]),
    ...createSourceMenuSection(section.title, section.sources, completeRequest),
  ]);

  if (sources.length === 0) {
    completeRequest();
    return;
  }

  template.push(
    { type: 'separator' },
    {
      label: 'Cancelar',
      click: () => {
        completeRequest();
      },
    },
  );

  Menu.buildFromTemplate(template).popup({
    window,
    callback: () => {
      completeRequest();
    },
  });
}

function createSourceMenuSection(
  title: string,
  sources: DesktopCapturerSource[],
  onSelect: (source: DesktopCapturerSource) => void,
): MenuItemConstructorOptions[] {
  if (sources.length === 0) {
    return [];
  }

  return [
    {
      label: title,
      enabled: false,
    },
    ...sources.map((source) => ({
      label: source.name,
      click: () => {
        onSelect(source);
      },
    })),
  ];
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    return webContents?.id === mainWindow?.webContents.id && permission === 'media';
  });
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const isMainRenderer = webContents.id === mainWindow?.webContents.id;

    callback(isMainRenderer && permission === 'media');
  });
  registerDisplayMediaRequestHandler();
  await createMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
