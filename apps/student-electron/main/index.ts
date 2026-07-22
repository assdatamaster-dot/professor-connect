import { app, BrowserWindow, session } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { registerDesktopIpc, type DesktopIpcRegistration } from './ipc.js';
import { StudentPresenceController } from './student-presence.controller.js';
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

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    ipcRegistration?.dispose();
    presenceController?.dispose();
    workflowController?.dispose();
    ipcRegistration = undefined;
    presenceController = undefined;
    workflowController = undefined;
    mainWindow = undefined;
  });

  await mainWindow.loadFile(rendererPath);
  void presenceController.connect().catch((error: unknown) => {
    console.error('[student-presence] Não foi possível conectar ao servidor', error);
  });
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const isMainRenderer = webContents.id === mainWindow?.webContents.id;

    callback(isMainRenderer && permission === 'media');
  });
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
