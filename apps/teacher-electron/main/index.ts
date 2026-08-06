import { app, BrowserWindow, dialog, session } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

import { FileTransferStorage } from '@professor-connect/engine/file-transfer-node';
import { DesktopAuthClient } from '@professor-connect/shared';
import {
  ElectronSecureTokenStore,
  registerDesktopAuthIpc,
} from '@professor-connect/shared/electron';

import { registerFileTransferIpc, type FileTransferIpcRegistration } from './file-transfer-ipc.js';
import { registerTeacherIpc, type TeacherIpcRegistration } from './ipc.js';
import { registerPresenceIpc, type PresenceIpcRegistration } from './presence-ipc.js';
import { ProfessorPresenceController } from './professor-presence.controller.js';
import { TeacherWorkflowController } from './teacher-workflow.controller.js';
import { createWindowOptions } from './window-options.js';
import { createTeacherWorkflowManager } from './workflow-composition.js';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | undefined;
let fileTransferIpcRegistration: FileTransferIpcRegistration | undefined;
let ipcRegistration: TeacherIpcRegistration | undefined;
let presenceIpcRegistration: PresenceIpcRegistration | undefined;
let presenceController: ProfessorPresenceController | undefined;
let workflowController: TeacherWorkflowController | undefined;
let authIpcRegistration: { dispose(): void } | undefined;

async function createMainWindow(): Promise<void> {
  const preloadPath = path.join(currentDirectory, '..', 'preload', 'index.js');
  const rendererPath = path.join(currentDirectory, '..', 'renderer', 'presence.html');
  const configPath = path.join(currentDirectory, '..', 'config.json');
  const iconPath = path.join(currentDirectory, '..', 'assets', 'logo.png');
  const manager = createTeacherWorkflowManager();
  const { serverUrl } = JSON.parse(await readFile(configPath, 'utf8')) as { serverUrl: string };
  const authClient = new DesktopAuthClient(
    serverUrl,
    new ElectronSecureTokenStore(app.getPath('userData')),
    Date.now,
  );

  workflowController = new TeacherWorkflowController(manager);
  presenceController = new ProfessorPresenceController(configPath, undefined, authClient);
  mainWindow = new BrowserWindow(createWindowOptions(preloadPath, iconPath));
  const window = mainWindow;
  ipcRegistration = registerTeacherIpc(workflowController, mainWindow.webContents);
  const fileTransferStorage = new FileTransferStorage({
    downloadsPath: app.getPath('downloads'),
    userDataPath: app.getPath('userData'),
    selectFiles: async () => {
      const result = await dialog.showOpenDialog(window, {
        title: 'Transferir arquivos para o aluno',
        buttonLabel: 'Selecionar',
        properties: ['openFile', 'multiSelections'],
      });
      return result.canceled ? [] : result.filePaths;
    },
    resolveDuplicate: async () => 'rename',
  });
  await fileTransferStorage.getSettings();
  fileTransferIpcRegistration = registerFileTransferIpc(
    fileTransferStorage,
    mainWindow.webContents,
    { onAudit: (entry) => presenceController?.reportFileTransfer(entry) },
  );
  presenceIpcRegistration = registerPresenceIpc(presenceController, mainWindow.webContents);
  authIpcRegistration = registerDesktopAuthIpc(
    authClient,
    mainWindow.webContents,
    {
      login: 'teacher:auth:login',
      register: 'teacher:auth:register',
      logout: 'teacher:auth:logout',
      getIdentity: 'teacher:auth:get-identity',
      getProfile: 'teacher:auth:get-profile',
      updateProfile: 'teacher:auth:update-profile',
    },
    {
      requiredRole: 'TEACHER',
      afterLogin: (identity) =>
        presenceController?.connect(identity.displayName).then(() => undefined) ??
        Promise.resolve(),
      beforeLogout: () => {
        presenceController?.disconnect();
      },
    },
  );

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    fileTransferIpcRegistration?.dispose();
    ipcRegistration?.dispose();
    presenceIpcRegistration?.dispose();
    authIpcRegistration?.dispose();
    workflowController?.dispose();
    presenceController?.dispose();
    fileTransferIpcRegistration = undefined;
    ipcRegistration = undefined;
    presenceIpcRegistration = undefined;
    authIpcRegistration = undefined;
    workflowController = undefined;
    presenceController = undefined;
    mainWindow = undefined;
  });

  await mainWindow.loadFile(rendererPath);
  const savedIdentity = await authClient.getIdentity();
  if (savedIdentity?.roles.includes('TEACHER') === true) {
    void presenceController.connect(savedIdentity.displayName).catch(() => authClient.logout());
  }
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    return webContents?.id === mainWindow?.webContents.id && permission === 'media';
  });
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
