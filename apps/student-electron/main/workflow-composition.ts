import {
  HealthCheckService,
  ResourceManager,
  WorkflowManager,
  type RemoteCommand,
  type WorkflowDependencies,
  type WorkflowLogger,
  type WorkflowManagerPort,
  type WorkflowStartInput,
} from '@professor-connect/engine';

interface DesktopRuntimeState {
  socketsConnected: boolean;
  heartbeatHealthy: boolean;
  sessionActive: boolean;
  callActive: boolean;
  peerConnected: boolean;
  mediaAvailable: boolean;
  dataChannelOpen: boolean;
  screenSharing: boolean;
  remoteControl: boolean;
}

/**
 * Composition adapter for the MVP desktop shell. It deliberately implements
 * only Workflow ports; concrete network and browser adapters can replace it
 * without changing the Electron presentation.
 */
class DesktopWorkflowRuntime {
  private requestSequence = 0;
  private sessionSequence = 0;
  private callSequence = 0;
  private state: DesktopRuntimeState = {
    socketsConnected: false,
    heartbeatHealthy: false,
    sessionActive: false,
    callActive: false,
    peerConnected: false,
    mediaAvailable: false,
    dataChannelOpen: false,
    screenSharing: false,
    remoteControl: false,
  };

  public readonly dependencies: WorkflowDependencies = {
    connection: {
      connectParticipants: () => {
        this.state.socketsConnected = true;
      },
      recoverParticipants: () => {
        this.state.socketsConnected = true;
        this.state.heartbeatHealthy = true;
      },
      areSocketsConnected: () => this.state.socketsConnected,
    },
    presence: {
      registerParticipants: () => undefined,
      isReady: () => this.state.socketsConnected,
    },
    request: {
      createRequest: () => `desktop-request-${++this.requestSequence}`,
      acceptRequest: () => undefined,
      cancelTimers: () => undefined,
    },
    session: {
      createSession: () => {
        this.state.sessionActive = true;
        return `desktop-session-${++this.sessionSequence}`;
      },
      closeSession: () => {
        this.state.sessionActive = false;
      },
      isActive: () => this.state.sessionActive,
    },
    call: {
      createCall: () => {
        this.state.callActive = true;
        return `desktop-call-${++this.callSequence}`;
      },
      connectCall: () => undefined,
      finishCall: () => {
        this.state.callActive = false;
      },
      failCall: () => {
        this.state.callActive = false;
      },
      isActive: () => this.state.callActive,
    },
    signaling: {
      prepare: () => undefined,
      removeListeners: () => undefined,
    },
    rtc: {
      connect: async () => {
        this.state.peerConnected = true;
        this.state.mediaAvailable = true;
      },
      reconnect: async () => {
        this.state.peerConnected = true;
        this.state.mediaAvailable = true;
      },
      close: async () => {
        this.state.peerConnected = false;
        this.state.mediaAvailable = false;
      },
      isPeerConnected: () => this.state.peerConnected,
      hasMediaStreams: () => this.state.mediaAvailable,
    },
    dataChannel: {
      connect: async () => {
        this.state.dataChannelOpen = true;
      },
      reconnect: async () => {
        this.state.dataChannelOpen = true;
      },
      close: async () => {
        this.state.dataChannelOpen = false;
      },
      isOpen: () => this.state.dataChannelOpen,
    },
    heartbeat: {
      start: () => {
        this.state.heartbeatHealthy = true;
      },
      stop: () => {
        this.state.heartbeatHealthy = false;
      },
      isHealthy: () => this.state.heartbeatHealthy,
    },
    screenSharing: {
      start: async () => {
        this.state.screenSharing = true;
      },
      stop: async () => {
        this.state.screenSharing = false;
      },
      isActive: () => this.state.screenSharing,
    },
    remoteControl: {
      authorize: async () => {
        this.state.remoteControl = true;
      },
      sendCommand: (command: RemoteCommand) => {
        void command;
      },
      revoke: async () => {
        this.state.remoteControl = false;
      },
      isActive: () => this.state.remoteControl,
    },
  };

  public clear(workflowId: string): void {
    void workflowId;
    this.state.socketsConnected = false;
  }
}

const consoleWorkflowLogger: WorkflowLogger = {
  info(message, context): void {
    console.info(`[workflow] ${message}`, context ?? {});
  },
  error(message, error): void {
    console.error(`[workflow] ${message}`, error);
  },
};

export function createDesktopWorkflowManager(): WorkflowManagerPort {
  const runtime = new DesktopWorkflowRuntime();
  const healthCheck = new HealthCheckService(runtime.dependencies);
  const resources = new ResourceManager({
    ...runtime.dependencies,
    memory: { clear: (workflowId: string) => runtime.clear(workflowId) },
    logger: consoleWorkflowLogger,
  });

  return new WorkflowManager(runtime.dependencies, resources, healthCheck, {
    logger: consoleWorkflowLogger,
  });
}

export const DEFAULT_STUDENT_WORKFLOW_INPUT: WorkflowStartInput = {
  student: {
    clientId: 'student-desktop',
    connectionId: 'student-electron',
    displayName: 'Aluno',
  },
  teacher: {
    clientId: 'professor-pool',
    connectionId: 'professor-pending',
    displayName: 'Professor',
  },
};
