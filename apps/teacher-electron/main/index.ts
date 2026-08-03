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
  );

  workflowController = new TeacherWorkflowController(manager);
  presenceController = new ProfessorPresenceController(configPath, undefined, authClient);
  mainWindow = new BrowserWindow(createWindowOptions(preloadPath, iconPath));
  const window = mainWindow;
  ipcRegistration = registerTeacherIpc(workflowController, mainWindow.webContents);
  const fileTransferStorage = new FileTransferStorage({
    documentsPath: app.getPath('documents'),
    userDataPath: app.getPath('userData'),
    selectFiles: async () => {
      const result = await dialog.showOpenDialog(window, {
        title: 'Transferir arquivos para o aluno',
        buttonLabel: 'Selecionar',
        properties: ['openFile', 'multiSelections'],
      });
      return result.canceled ? [] : result.filePaths;
    },
    resolveDuplicate: async ({ fileName }) => {
      const result = await dialog.showMessageBox(window, {
        type: 'question',
        title: 'Arquivo já existente',
        message: `O arquivo "${fileName}" já existe.`,
        detail: 'Escolha como deseja salvar o arquivo recebido.',
        buttons: ['Substituir', 'Renomear automaticamente', 'Cancelar'],
        defaultId: 1,
        cancelId: 2,
        noLink: true,
      });
      return result.response === 0 ? 'replace' : result.response === 1 ? 'rename' : 'cancel';
    },
  });
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
      logout: 'teacher:auth:logout',
      getIdentity: 'teacher:auth:get-identity',
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
