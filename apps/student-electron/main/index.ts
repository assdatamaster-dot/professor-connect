import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  screen,
  session,
  webContents,
} from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

import { createStructuredLogger } from '@professor-connect/engine';
import { FileTransferStorage } from '@professor-connect/engine/file-transfer-node';
import { DesktopAuthClient } from '@professor-connect/shared';
import {
  ElectronSecureTokenStore,
  registerDesktopAuthIpc,
} from '@professor-connect/shared/electron';

import { AllScreensCaptureCoordinator } from './all-screens-capture.coordinator.js';
import { registerFileTransferIpc, type FileTransferIpcRegistration } from './file-transfer-ipc.js';
import { registerDesktopIpc, type DesktopIpcRegistration } from './ipc.js';
import { RemoteControlReceiver } from './remote-control.receiver.js';
import { createRemoteInputController } from './remote-input/create-remote-input-controller.js';
import { ScreenCaptureTargetRegistry } from './screen-capture-target.registry.js';
import { registerSessionIpc, type SessionIpcRegistration } from './session-ipc.js';
import { StudentPresenceController } from './student-presence.controller.js';
import { StudentWorkflowController } from './student-workflow.controller.js';
import { createWindowOptions } from './window-options.js';
import {
  createDesktopWorkflowManager,
  DEFAULT_STUDENT_WORKFLOW_INPUT,
} from './workflow-composition.js';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const studentMainLogger = createStructuredLogger('student-main');
let mainWindow: BrowserWindow | undefined;
let fileTransferIpcRegistration: FileTransferIpcRegistration | undefined;
let ipcRegistration: DesktopIpcRegistration | undefined;
let presenceController: StudentPresenceController | undefined;
let sessionIpcRegistration: SessionIpcRegistration | undefined;
let workflowController: StudentWorkflowController | undefined;
let screenCaptureTargetRegistry: ScreenCaptureTargetRegistry | undefined;
let allScreensCaptureCoordinator: AllScreensCaptureCoordinator | undefined;
let unsubscribeCaptureSession: (() => void) | undefined;
let authIpcRegistration: { dispose(): void } | undefined;

async function createMainWindow(): Promise<void> {
  const preloadPath = path.join(currentDirectory, '..', 'preload', 'index.js');
  const rendererPath = path.join(currentDirectory, '..', 'renderer', 'index.html');
  const configPath = path.join(currentDirectory, '..', 'config.json');
  const iconPath = path.join(currentDirectory, '..', 'assets', 'logo.png');
  const manager = createDesktopWorkflowManager();
  const { serverUrl } = JSON.parse(await readFile(configPath, 'utf8')) as { serverUrl: string };
  const authClient = new DesktopAuthClient(
    serverUrl,
    new ElectronSecureTokenStore(app.getPath('userData')),
  );

  workflowController = new StudentWorkflowController(manager, {
    startInput: DEFAULT_STUDENT_WORKFLOW_INPUT,
  });
  mainWindow = new BrowserWindow(createWindowOptions(preloadPath, iconPath));
  const window = mainWindow;
  ipcRegistration = registerDesktopIpc(workflowController, mainWindow.webContents);
  const fileTransferStorage = new FileTransferStorage({
    documentsPath: app.getPath('documents'),
    userDataPath: app.getPath('userData'),
    selectFiles: async () => {
      const result = await dialog.showOpenDialog(window, {
        title: 'Transferir arquivos para o professor',
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
  const captureTargetRegistry = requireScreenCaptureTargetRegistry();
  const captureCoordinator = requireAllScreensCaptureCoordinator();
  const remoteControlReceiver = new RemoteControlReceiver({
    inputController: createRemoteInputController(captureTargetRegistry),
  });
  presenceController = new StudentPresenceController(
    configPath,
    undefined,
    undefined,
    remoteControlReceiver,
    authClient,
  );
  sessionIpcRegistration = registerSessionIpc(presenceController, mainWindow.webContents, {
    onScreenShareStopped: () => captureCoordinator.clear(),
    prepareAllScreensCapture: () => captureCoordinator.prepare(),
  });
  authIpcRegistration = registerDesktopAuthIpc(
    authClient,
    mainWindow.webContents,
    {
      login: 'student:auth:login',
      logout: 'student:auth:logout',
      getIdentity: 'student:auth:get-identity',
    },
    {
      requiredRole: 'STUDENT',
      afterLogin: () => presenceController?.connect() ?? Promise.resolve(),
      beforeLogout: () => {
        presenceController?.disconnect();
      },
    },
  );
  unsubscribeCaptureSession = presenceController.onSessionStateChanged((snapshot) => {
    if (snapshot.activeSessionId === undefined) {
      captureCoordinator.clear();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    fileTransferIpcRegistration?.dispose();
    ipcRegistration?.dispose();
    unsubscribeCaptureSession?.();
    allScreensCaptureCoordinator?.clear();
    presenceController?.dispose();
    sessionIpcRegistration?.dispose();
    authIpcRegistration?.dispose();
    workflowController?.dispose();
    fileTransferIpcRegistration = undefined;
    ipcRegistration = undefined;
    presenceController = undefined;
    sessionIpcRegistration = undefined;
    authIpcRegistration = undefined;
    workflowController = undefined;
    unsubscribeCaptureSession = undefined;
    mainWindow = undefined;
  });

  await mainWindow.loadFile(rendererPath);
  const savedIdentity = await authClient.getIdentity();
  if (savedIdentity?.roles.includes('STUDENT') === true) {
    void presenceController.connect().catch((error: unknown) => {
      studentMainLogger.error('presence-connect-failed', error);
    });
  }
}

function registerDisplayMediaRequestHandler(): void {
  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      const window = mainWindow;
      const requestingWebContents =
        request.frame === null ? undefined : webContents.fromFrame(request.frame);
      const coordinator = requireAllScreensCaptureCoordinator();

      if (
        window === undefined ||
        window.isDestroyed() ||
        requestingWebContents?.id !== window.webContents.id ||
        !request.videoRequested ||
        !coordinator.hasPendingSource()
      ) {
        callback({});
        return;
      }

      const source = coordinator.takeNextSource();
      callback(source === undefined ? {} : { video: source });
    },
    { useSystemPicker: false },
  );
}

app.whenReady().then(async () => {
  screenCaptureTargetRegistry = new ScreenCaptureTargetRegistry(screen);
  allScreensCaptureCoordinator = new AllScreensCaptureCoordinator(
    () =>
      desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 0, height: 0 },
        fetchWindowIcons: false,
      }),
    screenCaptureTargetRegistry,
  );
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

function requireScreenCaptureTargetRegistry(): ScreenCaptureTargetRegistry {
  if (screenCaptureTargetRegistry === undefined) {
    throw new Error('Registro de tela compartilhada não está inicializado');
  }
  return screenCaptureTargetRegistry;
}

function requireAllScreensCaptureCoordinator(): AllScreensCaptureCoordinator {
  if (allScreensCaptureCoordinator === undefined) {
    throw new Error('Captura de todos os monitores não está inicializada');
  }
  return allScreensCaptureCoordinator;
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
