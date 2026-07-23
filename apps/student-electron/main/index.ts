import { app, BrowserWindow, desktopCapturer, screen, session, webContents } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AllScreensCaptureCoordinator } from './all-screens-capture.coordinator.js';
import { registerDesktopIpc, type DesktopIpcRegistration } from './ipc.js';
import { RemoteControlReceiver } from './remote-control.receiver.js';
import { createRemoteMouseController } from './remote-mouse/create-remote-mouse-controller.js';
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
let mainWindow: BrowserWindow | undefined;
let ipcRegistration: DesktopIpcRegistration | undefined;
let presenceController: StudentPresenceController | undefined;
let sessionIpcRegistration: SessionIpcRegistration | undefined;
let workflowController: StudentWorkflowController | undefined;
let screenCaptureTargetRegistry: ScreenCaptureTargetRegistry | undefined;
let allScreensCaptureCoordinator: AllScreensCaptureCoordinator | undefined;
let unsubscribeCaptureSession: (() => void) | undefined;

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
  const captureTargetRegistry = requireScreenCaptureTargetRegistry();
  const captureCoordinator = requireAllScreensCaptureCoordinator();
  const remoteControlReceiver = new RemoteControlReceiver({
    mouseController: createRemoteMouseController(captureTargetRegistry),
  });
  presenceController = new StudentPresenceController(
    configPath,
    undefined,
    undefined,
    remoteControlReceiver,
  );
  sessionIpcRegistration = registerSessionIpc(presenceController, mainWindow.webContents, {
    onScreenShareStopped: () => captureCoordinator.clear(),
    prepareAllScreensCapture: () => captureCoordinator.prepare(),
  });
  unsubscribeCaptureSession = presenceController.onSessionStateChanged((snapshot) => {
    if (snapshot.activeSessionId === undefined) {
      captureCoordinator.clear();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    ipcRegistration?.dispose();
    unsubscribeCaptureSession?.();
    allScreensCaptureCoordinator?.clear();
    presenceController?.dispose();
    sessionIpcRegistration?.dispose();
    workflowController?.dispose();
    ipcRegistration = undefined;
    presenceController = undefined;
    sessionIpcRegistration = undefined;
    workflowController = undefined;
    unsubscribeCaptureSession = undefined;
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
