import {
  HealthCheckService,
  ResourceManager,
  WorkflowManager,
  type RemoteCommand,
  type WorkflowDependencies,
  type WorkflowLogger,
  type WorkflowManagerPort,
} from '@professor-connect/engine';

import {
  TeacherRequestStatus,
  TeacherStudentStatus,
  type TeacherAttendanceRequest,
  type TeacherStudent,
} from '../shared/contracts.js';
import {
  TeacherWorkflowManager,
  type TeacherWorkflowManagerPort,
} from './teacher-workflow.manager.js';

interface TeacherRuntimeState {
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

class TeacherWorkflowRuntime {
  private requestSequence = 0;
  private sessionSequence = 0;
  private callSequence = 0;
  private state: TeacherRuntimeState = {
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
      createRequest: () => `teacher-request-${++this.requestSequence}`,
      acceptRequest: () => undefined,
      cancelTimers: () => undefined,
    },
    session: {
      createSession: () => {
        this.state.sessionActive = true;
        return `teacher-session-${++this.sessionSequence}`;
      },
      closeSession: () => {
        this.state.sessionActive = false;
      },
      isActive: () => this.state.sessionActive,
    },
    call: {
      createCall: () => {
        this.state.callActive = true;
        return `teacher-call-${++this.callSequence}`;
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
    console.info(`[teacher-workflow] ${message}`, context ?? {});
  },
  error(message, error): void {
    console.error(`[teacher-workflow] ${message}`, error);
  },
};

const DEFAULT_STUDENTS: readonly TeacherStudent[] = [
  {
    studentId: 'student-ana',
    displayName: 'Ana Souza',
    status: TeacherStudentStatus.AVAILABLE,
  },
  {
    studentId: 'student-bruno',
    displayName: 'Bruno Lima',
    status: TeacherStudentStatus.ONLINE,
  },
];

const DEFAULT_REQUESTS: readonly TeacherAttendanceRequest[] = [
  {
    requestId: 'request-ana',
    studentId: 'student-ana',
    studentName: 'Ana Souza',
    createdAt: new Date().toISOString(),
    status: TeacherRequestStatus.PENDING,
  },
];

function createWorkflowManager(): WorkflowManagerPort {
  const runtime = new TeacherWorkflowRuntime();
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

export function createTeacherWorkflowManager(): TeacherWorkflowManagerPort {
  return new TeacherWorkflowManager(createWorkflowManager(), {
    teacher: {
      clientId: 'teacher-desktop',
      connectionId: 'teacher-electron',
      displayName: 'Professor',
    },
    onlineStudents: DEFAULT_STUDENTS,
    requests: DEFAULT_REQUESTS,
  });
}
