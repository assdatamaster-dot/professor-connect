import { WorkflowEventType, WorkflowState, type WorkflowEvent } from '@professor-connect/engine';

import {
  TeacherActionStatus,
  TeacherAttendanceStatus,
  TeacherConnectionStatus,
  TeacherLogCategory,
  TeacherLogLevel,
  type TeacherAttendanceRequest,
  type TeacherLogEntry,
  type TeacherStateListener,
  type TeacherWorkflowSnapshot,
} from '../shared/contracts.js';
import type { TeacherWorkflowManagerPort } from './teacher-workflow.manager.js';

const MAX_LOG_ENTRIES = 100;

export interface TeacherWorkflowControllerOptions {
  readonly clock?: () => Date;
  readonly logIdFactory?: () => string;
}

interface MutableTeacherState {
  connectionStatus: TeacherConnectionStatus;
  attendanceStatus: TeacherAttendanceStatus;
  screenSharingStatus: TeacherActionStatus;
  remoteControlStatus: TeacherActionStatus;
  statusMessage: string;
  activeStudentName: string | undefined;
  isMediaVisible: boolean;
}

export class TeacherWorkflowController {
  private readonly listeners = new Set<TeacherStateListener>();
  private readonly logs: TeacherLogEntry[] = [];
  private readonly clock: () => Date;
  private readonly logIdFactory: () => string;
  private readonly unsubscribeState: () => void;
  private readonly unsubscribeEvent: () => void;
  private state: MutableTeacherState = {
    connectionStatus: TeacherConnectionStatus.DISCONNECTED,
    attendanceStatus: TeacherAttendanceStatus.IDLE,
    screenSharingStatus: TeacherActionStatus.IDLE,
    remoteControlStatus: TeacherActionStatus.IDLE,
    statusMessage: 'Conecte-se para receber solicitações de atendimento.',
    activeStudentName: undefined,
    isMediaVisible: false,
  };

  public constructor(
    private readonly workflowManager: TeacherWorkflowManagerPort,
    options: TeacherWorkflowControllerOptions = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
    this.logIdFactory = options.logIdFactory ?? (() => globalThis.crypto.randomUUID());
    this.unsubscribeState = workflowManager.onStateChanged(({ nextState }) => {
      this.applyWorkflowState(nextState);
    });
    this.unsubscribeEvent = workflowManager.onEvent((event) => {
      this.applyWorkflowEvent(event);
    });
  }

  public async initialize(): Promise<TeacherWorkflowSnapshot> {
    this.patchState({
      connectionStatus: TeacherConnectionStatus.CONNECTING,
      statusMessage: 'Conectando ao Professor Connect…',
    });
    this.appendLog(TeacherLogCategory.CONNECTION, 'Conexão iniciada.');
    this.publish();

    try {
      await this.workflowManager.connect();
      const requestCount = this.workflowManager.getPendingRequests().length;

      this.patchState({
        connectionStatus: TeacherConnectionStatus.CONNECTED,
        attendanceStatus:
          requestCount > 0
            ? TeacherAttendanceStatus.REQUEST_PENDING
            : TeacherAttendanceStatus.AVAILABLE,
        statusMessage:
          requestCount > 0
            ? 'Há solicitações aguardando sua resposta.'
            : 'Disponível para novos atendimentos.',
      });
      this.appendLog(TeacherLogCategory.CONNECTION, 'Professor conectado.');
      for (const request of this.workflowManager.getPendingRequests()) {
        this.appendLog(
          TeacherLogCategory.REQUEST,
          `Solicitação recebida de ${request.studentName}.`,
        );
      }
      return this.publish();
    } catch (error) {
      return this.fail('Não foi possível conectar o aplicativo.', error);
    }
  }

  public async acceptRequest(requestId: string): Promise<TeacherWorkflowSnapshot> {
    const request = this.findRequest(requestId);

    if (request === undefined || !this.getSnapshot().canAcceptRequests) {
      return this.getSnapshot();
    }

    this.patchState({
      attendanceStatus: TeacherAttendanceStatus.PREPARING,
      activeStudentName: request.studentName,
      statusMessage: `Preparando atendimento com ${request.studentName}…`,
    });
    this.appendLog(TeacherLogCategory.REQUEST, `Solicitação de ${request.studentName} aceita.`);
    this.publish();

    try {
      await this.workflowManager.acceptRequest(requestId);
      return this.getSnapshot();
    } catch (error) {
      return this.fail('Não foi possível aceitar a solicitação.', error);
    }
  }

  public async rejectRequest(requestId: string): Promise<TeacherWorkflowSnapshot> {
    const request = this.findRequest(requestId);

    if (request === undefined || !this.getSnapshot().canAcceptRequests) {
      return this.getSnapshot();
    }

    try {
      await this.workflowManager.rejectRequest(requestId);
      this.appendLog(TeacherLogCategory.REQUEST, `Solicitação de ${request.studentName} recusada.`);
      this.refreshAvailability();
      return this.publish();
    } catch (error) {
      return this.fail('Não foi possível recusar a solicitação.', error);
    }
  }

  public async requestScreenSharing(): Promise<TeacherWorkflowSnapshot> {
    if (!this.getSnapshot().canRequestScreenSharing) {
      return this.getSnapshot();
    }

    try {
      this.patchState({ screenSharingStatus: TeacherActionStatus.REQUESTED });
      this.appendLog(TeacherLogCategory.SCREEN, 'Compartilhamento de tela solicitado.');
      this.publish();
      await this.workflowManager.requestScreenSharing();
      return this.getSnapshot();
    } catch (error) {
      return this.fail('Não foi possível solicitar o compartilhamento de tela.', error);
    }
  }

  public async requestRemoteControl(): Promise<TeacherWorkflowSnapshot> {
    if (!this.getSnapshot().canRequestRemoteControl) {
      return this.getSnapshot();
    }

    try {
      this.patchState({ remoteControlStatus: TeacherActionStatus.REQUESTED });
      this.appendLog(TeacherLogCategory.REMOTE, 'Controle remoto solicitado.');
      this.publish();
      await this.workflowManager.requestRemoteControl();
      return this.getSnapshot();
    } catch (error) {
      return this.fail('Não foi possível solicitar o controle remoto.', error);
    }
  }

  public async endAttendance(): Promise<TeacherWorkflowSnapshot> {
    if (!this.getSnapshot().canEndAttendance) {
      return this.getSnapshot();
    }

    this.patchState({
      attendanceStatus: TeacherAttendanceStatus.ENDING,
      statusMessage: 'Encerrando atendimento…',
    });
    this.publish();

    try {
      await this.workflowManager.endAttendance();
      return this.getSnapshot();
    } catch (error) {
      return this.fail('Não foi possível encerrar o atendimento.', error);
    }
  }

  public getSnapshot(): TeacherWorkflowSnapshot {
    const isActive = this.state.attendanceStatus === TeacherAttendanceStatus.ACTIVE;
    const requests = this.workflowManager.getPendingRequests();

    return {
      ...this.state,
      onlineStudents: this.workflowManager.getOnlineStudents(),
      requests,
      canAcceptRequests:
        this.state.connectionStatus === TeacherConnectionStatus.CONNECTED &&
        !isActive &&
        this.state.attendanceStatus !== TeacherAttendanceStatus.PREPARING &&
        requests.length > 0,
      canRequestScreenSharing:
        isActive && this.state.screenSharingStatus === TeacherActionStatus.IDLE,
      canRequestRemoteControl:
        isActive && this.state.remoteControlStatus === TeacherActionStatus.IDLE,
      canEndAttendance: isActive,
      logs: [...this.logs],
    };
  }

  public onStateChanged(listener: TeacherStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public dispose(): void {
    this.unsubscribeState();
    this.unsubscribeEvent();
    this.listeners.clear();
  }

  private applyWorkflowState(state: WorkflowState): void {
    const presentation = WORKFLOW_PRESENTATION[state];

    this.patchState(presentation);
    if (state === WorkflowState.ACTIVE) {
      this.appendLog(TeacherLogCategory.CALL, 'Call iniciada.');
      this.appendLog(TeacherLogCategory.VIDEO, 'Vídeos local e remoto iniciados.');
    }
    if (state === WorkflowState.COMPLETED) {
      this.appendLog(TeacherLogCategory.CALL, 'Atendimento encerrado.');
      this.refreshAvailability();
    }
    this.publish();
  }

  private applyWorkflowEvent(event: WorkflowEvent): void {
    const log = EVENT_LOGS[event.type];

    if (event.type === WorkflowEventType.SCREEN_SHARING_STARTED) {
      this.patchState({ screenSharingStatus: TeacherActionStatus.AUTHORIZED });
    }
    if (event.type === WorkflowEventType.REMOTE_CONTROL_AUTHORIZED) {
      this.patchState({ remoteControlStatus: TeacherActionStatus.AUTHORIZED });
    }
    if (log !== undefined) {
      this.appendLog(log.category, log.message, log.level);
      this.publish();
    }
  }

  private refreshAvailability(): void {
    if (this.state.attendanceStatus === TeacherAttendanceStatus.ACTIVE) {
      return;
    }
    const hasRequests = this.workflowManager.getPendingRequests().length > 0;

    this.patchState({
      attendanceStatus: hasRequests
        ? TeacherAttendanceStatus.REQUEST_PENDING
        : TeacherAttendanceStatus.AVAILABLE,
      statusMessage: hasRequests
        ? 'Há solicitações aguardando sua resposta.'
        : 'Disponível para novos atendimentos.',
    });
  }

  private findRequest(requestId: string): TeacherAttendanceRequest | undefined {
    return this.workflowManager
      .getPendingRequests()
      .find((request) => request.requestId === requestId);
  }

  private fail(message: string, error: unknown): TeacherWorkflowSnapshot {
    const detail = error instanceof Error ? error.message : 'Falha desconhecida';

    this.patchState({
      connectionStatus: TeacherConnectionStatus.ERROR,
      attendanceStatus: TeacherAttendanceStatus.ERROR,
      screenSharingStatus: TeacherActionStatus.IDLE,
      remoteControlStatus: TeacherActionStatus.IDLE,
      statusMessage: message,
      isMediaVisible: false,
    });
    this.appendLog(TeacherLogCategory.ERROR, `${message} ${detail}`, TeacherLogLevel.ERROR);
    return this.publish();
  }

  private patchState(update: Readonly<Partial<MutableTeacherState>>): void {
    this.state = { ...this.state, ...update };
  }

  private appendLog(
    category: TeacherLogCategory,
    message: string,
    level: TeacherLogLevel = TeacherLogLevel.INFO,
  ): void {
    this.logs.push({
      id: this.logIdFactory(),
      timestamp: this.clock().toISOString(),
      category,
      level,
      message,
    });
    if (this.logs.length > MAX_LOG_ENTRIES) {
      this.logs.splice(0, this.logs.length - MAX_LOG_ENTRIES);
    }
  }

  private publish(): TeacherWorkflowSnapshot {
    const snapshot = this.getSnapshot();

    for (const listener of this.listeners) {
      listener(snapshot);
    }
    return snapshot;
  }
}

const WORKFLOW_PRESENTATION: Readonly<
  Record<WorkflowState, Readonly<Partial<MutableTeacherState>>>
> = {
  [WorkflowState.IDLE]: {},
  [WorkflowState.CONNECTING]: {
    attendanceStatus: TeacherAttendanceStatus.PREPARING,
    statusMessage: 'Preparando o atendimento…',
  },
  [WorkflowState.REQUESTED]: {
    attendanceStatus: TeacherAttendanceStatus.PREPARING,
    statusMessage: 'Solicitação aceita. Criando sessão…',
  },
  [WorkflowState.PREPARING]: {
    attendanceStatus: TeacherAttendanceStatus.PREPARING,
    statusMessage: 'Preparando chamada…',
  },
  [WorkflowState.NEGOTIATING]: {
    attendanceStatus: TeacherAttendanceStatus.PREPARING,
    statusMessage: 'Conectando áudio e vídeo…',
  },
  [WorkflowState.ACTIVE]: {
    attendanceStatus: TeacherAttendanceStatus.ACTIVE,
    statusMessage: 'Atendimento em andamento.',
    isMediaVisible: true,
  },
  [WorkflowState.RECOVERING]: {
    attendanceStatus: TeacherAttendanceStatus.PREPARING,
    statusMessage: 'Recuperando conexão…',
  },
  [WorkflowState.STOPPING]: {
    attendanceStatus: TeacherAttendanceStatus.ENDING,
    statusMessage: 'Encerrando atendimento…',
  },
  [WorkflowState.COMPLETED]: {
    attendanceStatus: TeacherAttendanceStatus.ENDED,
    screenSharingStatus: TeacherActionStatus.IDLE,
    remoteControlStatus: TeacherActionStatus.IDLE,
    statusMessage: 'Atendimento encerrado.',
    activeStudentName: undefined,
    isMediaVisible: false,
  },
  [WorkflowState.FAILED]: {
    connectionStatus: TeacherConnectionStatus.ERROR,
    attendanceStatus: TeacherAttendanceStatus.ERROR,
    screenSharingStatus: TeacherActionStatus.IDLE,
    remoteControlStatus: TeacherActionStatus.IDLE,
    statusMessage: 'O atendimento encontrou uma falha.',
    isMediaVisible: false,
  },
};

interface WorkflowEventLog {
  readonly category: TeacherLogCategory;
  readonly message: string;
  readonly level?: TeacherLogLevel;
}

const EVENT_LOGS: Readonly<Partial<Record<WorkflowEventType, WorkflowEventLog>>> = {
  [WorkflowEventType.REQUEST_ACCEPTED]: {
    category: TeacherLogCategory.REQUEST,
    message: 'Solicitação aceita pelo professor.',
  },
  [WorkflowEventType.CALL_CREATED]: {
    category: TeacherLogCategory.CALL,
    message: 'Call criada.',
  },
  [WorkflowEventType.MEDIA_STARTED]: {
    category: TeacherLogCategory.VIDEO,
    message: 'Áudio e vídeo iniciados.',
  },
  [WorkflowEventType.SCREEN_SHARING_STARTED]: {
    category: TeacherLogCategory.SCREEN,
    message: 'Solicitação de compartilhamento enviada.',
  },
  [WorkflowEventType.REMOTE_CONTROL_AUTHORIZED]: {
    category: TeacherLogCategory.REMOTE,
    message: 'Solicitação de controle remoto enviada.',
  },
  [WorkflowEventType.FAILED]: {
    category: TeacherLogCategory.ERROR,
    message: 'Falha no workflow de atendimento.',
    level: TeacherLogLevel.ERROR,
  },
};
