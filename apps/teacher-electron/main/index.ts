import { app, BrowserWindow, session } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { registerTeacherIpc, type TeacherIpcRegistration } from './ipc.js';
import { TeacherWorkflowController } from './teacher-workflow.controller.js';
import { createWindowOptions } from './window-options.js';
import { createTeacherWorkflowManager } from './workflow-composition.js';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | undefined;
let ipcRegistration: TeacherIpcRegistration | undefined;
let workflowController: TeacherWorkflowController | undefined;

async function createMainWindow(): Promise<void> {
  const preloadPath = path.join(currentDirectory, '..', 'preload', 'index.js');
  const rendererPath = path.join(currentDirectory, '..', 'renderer', 'index.html');
  const manager = createTeacherWorkflowManager();

  workflowController = new TeacherWorkflowController(manager);
  mainWindow = new BrowserWindow(createWindowOptions(preloadPath));
  ipcRegistration = registerTeacherIpc(workflowController, mainWindow.webContents);

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    ipcRegistration?.dispose();
    workflowController?.dispose();
    ipcRegistration = undefined;
    workflowController = undefined;
    mainWindow = undefined;
  });

  await mainWindow.loadFile(rendererPath);
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
