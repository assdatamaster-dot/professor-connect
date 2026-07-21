import {
  WorkflowEventType,
  WorkflowState,
  type WorkflowEvent,
  type WorkflowManagerPort,
  type WorkflowStartInput,
} from '@professor-connect/engine';

import {
  DesktopAttendanceStatus,
  DesktopConnectionStatus,
  DesktopLogCategory,
  DesktopLogLevel,
  DesktopRemoteControlStatus,
  type DesktopLogEntry,
  type DesktopStateListener,
  type DesktopWorkflowSnapshot,
} from '../shared/contracts.js';

const MAX_LOG_ENTRIES = 100;

export interface StudentWorkflowControllerOptions {
  readonly startInput: WorkflowStartInput;
  readonly clock?: () => Date;
  readonly logIdFactory?: () => string;
}

interface MutableDesktopState {
  connectionStatus: DesktopConnectionStatus;
  attendanceStatus: DesktopAttendanceStatus;
  remoteControlStatus: DesktopRemoteControlStatus;
  statusMessage: string;
  isMediaVisible: boolean;
  isScreenSharing: boolean;
}

export class StudentWorkflowController {
  private readonly listeners = new Set<DesktopStateListener>();
  private readonly logs: DesktopLogEntry[] = [];
  private readonly clock: () => Date;
  private readonly logIdFactory: () => string;
  private readonly unsubscribeState: () => void;
  private readonly unsubscribeEvent: () => void;
  private state: MutableDesktopState = {
    connectionStatus: DesktopConnectionStatus.DISCONNECTED,
    attendanceStatus: DesktopAttendanceStatus.IDLE,
    remoteControlStatus: DesktopRemoteControlStatus.NOT_AUTHORIZED,
    statusMessage: 'Pronto para iniciar um atendimento.',
    isMediaVisible: false,
    isScreenSharing: false,
  };

  public constructor(
    private readonly workflowManager: WorkflowManagerPort,
    private readonly options: StudentWorkflowControllerOptions,
  ) {
    this.clock = options.clock ?? (() => new Date());
    this.logIdFactory = options.logIdFactory ?? (() => globalThis.crypto.randomUUID());
    this.unsubscribeState = this.workflowManager.onStateChanged(({ nextState }) => {
      this.applyWorkflowState(nextState);
    });
    this.unsubscribeEvent = this.workflowManager.onEvent((event) => {
      this.applyWorkflowEvent(event);
    });
  }

  public initialize(): DesktopWorkflowSnapshot {
    this.appendLog(DesktopLogCategory.CONNECTION, 'Aplicação inicializada.');
    return this.publish();
  }

  public async callProfessor(): Promise<DesktopWorkflowSnapshot> {
    if (!this.getSnapshot().canCallProfessor) {
      return this.getSnapshot();
    }

    this.patchState({
      connectionStatus: DesktopConnectionStatus.CONNECTING,
      attendanceStatus: DesktopAttendanceStatus.REQUESTING,
      statusMessage: 'Conectando e procurando um professor disponível…',
    });
    this.appendLog(DesktopLogCategory.CONNECTION, 'Conexão iniciada.');
    this.publish();

    try {
      await this.workflowManager.begin(this.options.startInput);
      return this.getSnapshot();
    } catch (error) {
      return this.fail('Não foi possível chamar um professor.', error);
    }
  }

  public async acceptAttendance(): Promise<DesktopWorkflowSnapshot> {
    try {
      await this.workflowManager.accept();
      return this.getSnapshot();
    } catch (error) {
      return this.fail('Não foi possível iniciar o atendimento.', error);
    }
  }

  public async shareScreen(): Promise<DesktopWorkflowSnapshot> {
    if (!this.getSnapshot().canShareScreen) {
      return this.getSnapshot();
    }

    try {
      await this.workflowManager.startScreenSharing();
      this.patchState({ isScreenSharing: true });
      this.appendLog(DesktopLogCategory.SCREEN, 'Compartilhamento de tela iniciado.');
      return this.publish();
    } catch (error) {
      return this.fail('Não foi possível compartilhar a tela.', error);
    }
  }

  public async endAttendance(): Promise<DesktopWorkflowSnapshot> {
    if (!this.getSnapshot().canEndAttendance) {
      return this.getSnapshot();
    }

    this.patchState({
      attendanceStatus: DesktopAttendanceStatus.ENDING,
      statusMessage: 'Encerrando atendimento…',
    });
    this.publish();

    try {
      await this.workflowManager.end();
      return this.getSnapshot();
    } catch (error) {
      return this.fail('Não foi possível encerrar o atendimento.', error);
    }
  }

  public getSnapshot(): DesktopWorkflowSnapshot {
    const isActive = this.state.attendanceStatus === DesktopAttendanceStatus.ACTIVE;
    const canCallProfessor =
      this.state.attendanceStatus === DesktopAttendanceStatus.IDLE ||
      this.state.attendanceStatus === DesktopAttendanceStatus.ENDED ||
      this.state.attendanceStatus === DesktopAttendanceStatus.ERROR;

    return {
      ...this.state,
      canCallProfessor,
      canShareScreen: isActive && !this.state.isScreenSharing,
      canEndAttendance: isActive,
      logs: [...this.logs],
    };
  }

  public onStateChanged(listener: DesktopStateListener): () => void {
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
      this.appendLog(DesktopLogCategory.CALL, 'Atendimento iniciado.');
      this.appendLog(DesktopLogCategory.VIDEO, 'Vídeos local e remoto disponíveis.');
    }
    if (state === WorkflowState.COMPLETED) {
      this.appendLog(DesktopLogCategory.CALL, 'Atendimento encerrado.');
    }
    this.publish();
  }

  private applyWorkflowEvent(event: WorkflowEvent): void {
    const log = EVENT_LOGS[event.type];

    if (event.type === WorkflowEventType.REMOTE_CONTROL_AUTHORIZED) {
      this.patchState({ remoteControlStatus: DesktopRemoteControlStatus.AUTHORIZED });
    }
    if (log !== undefined) {
      this.appendLog(log.category, log.message, log.level);
      this.publish();
    }
  }

  private fail(message: string, error: unknown): DesktopWorkflowSnapshot {
    this.patchState({
      connectionStatus: DesktopConnectionStatus.ERROR,
      attendanceStatus: DesktopAttendanceStatus.ERROR,
      statusMessage: message,
      isMediaVisible: false,
      isScreenSharing: false,
    });
    const detail = error instanceof Error ? error.message : 'Falha desconhecida';

    this.appendLog(DesktopLogCategory.ERROR, `${message} ${detail}`, DesktopLogLevel.ERROR);
    return this.publish();
  }

  private patchState(update: Readonly<Partial<MutableDesktopState>>): void {
    this.state = { ...this.state, ...update };
  }

  private appendLog(
    category: DesktopLogCategory,
    message: string,
    level: DesktopLogLevel = DesktopLogLevel.INFO,
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

  private publish(): DesktopWorkflowSnapshot {
    const snapshot = this.getSnapshot();

    for (const listener of this.listeners) {
      listener(snapshot);
    }
    return snapshot;
  }
}

const WORKFLOW_PRESENTATION: Readonly<
  Record<WorkflowState, Readonly<Partial<MutableDesktopState>>>
> = {
  [WorkflowState.IDLE]: {
    connectionStatus: DesktopConnectionStatus.DISCONNECTED,
    attendanceStatus: DesktopAttendanceStatus.IDLE,
    statusMessage: 'Pronto para iniciar um atendimento.',
  },
  [WorkflowState.CONNECTING]: {
    connectionStatus: DesktopConnectionStatus.CONNECTING,
    attendanceStatus: DesktopAttendanceStatus.REQUESTING,
    statusMessage: 'Conectando…',
  },
  [WorkflowState.REQUESTED]: {
    connectionStatus: DesktopConnectionStatus.CONNECTED,
    attendanceStatus: DesktopAttendanceStatus.WAITING,
    statusMessage: 'Solicitação enviada. Aguarde um professor.',
  },
  [WorkflowState.PREPARING]: {
    connectionStatus: DesktopConnectionStatus.CONNECTED,
    attendanceStatus: DesktopAttendanceStatus.PREPARING,
    statusMessage: 'Professor aceitou. Preparando atendimento…',
  },
  [WorkflowState.NEGOTIATING]: {
    connectionStatus: DesktopConnectionStatus.CONNECTED,
    attendanceStatus: DesktopAttendanceStatus.PREPARING,
    statusMessage: 'Conectando áudio e vídeo…',
  },
  [WorkflowState.ACTIVE]: {
    connectionStatus: DesktopConnectionStatus.CONNECTED,
    attendanceStatus: DesktopAttendanceStatus.ACTIVE,
    statusMessage: 'Atendimento em andamento.',
    isMediaVisible: true,
  },
  [WorkflowState.RECOVERING]: {
    connectionStatus: DesktopConnectionStatus.CONNECTING,
    attendanceStatus: DesktopAttendanceStatus.PREPARING,
    statusMessage: 'Recuperando conexão…',
  },
  [WorkflowState.STOPPING]: {
    attendanceStatus: DesktopAttendanceStatus.ENDING,
    statusMessage: 'Encerrando atendimento…',
  },
  [WorkflowState.COMPLETED]: {
    connectionStatus: DesktopConnectionStatus.DISCONNECTED,
    attendanceStatus: DesktopAttendanceStatus.ENDED,
    remoteControlStatus: DesktopRemoteControlStatus.NOT_AUTHORIZED,
    statusMessage: 'Atendimento encerrado.',
    isMediaVisible: false,
    isScreenSharing: false,
  },
  [WorkflowState.FAILED]: {
    connectionStatus: DesktopConnectionStatus.ERROR,
    attendanceStatus: DesktopAttendanceStatus.ERROR,
    remoteControlStatus: DesktopRemoteControlStatus.NOT_AUTHORIZED,
    statusMessage: 'O atendimento encontrou uma falha.',
    isMediaVisible: false,
    isScreenSharing: false,
  },
};

interface WorkflowEventLog {
  readonly category: DesktopLogCategory;
  readonly message: string;
  readonly level?: DesktopLogLevel;
}

const EVENT_LOGS: Readonly<Partial<Record<WorkflowEventType, WorkflowEventLog>>> = {
  [WorkflowEventType.ATTENDANCE_STARTED]: {
    category: DesktopLogCategory.CONNECTION,
    message: 'Cliente conectado.',
  },
  [WorkflowEventType.REQUEST_CREATED]: {
    category: DesktopLogCategory.REQUEST,
    message: 'Solicitação enviada ao professor.',
  },
  [WorkflowEventType.REQUEST_ACCEPTED]: {
    category: DesktopLogCategory.REQUEST,
    message: 'Solicitação aceita.',
  },
  [WorkflowEventType.CALL_CREATED]: {
    category: DesktopLogCategory.CALL,
    message: 'Chamada criada.',
  },
  [WorkflowEventType.MEDIA_STARTED]: {
    category: DesktopLogCategory.VIDEO,
    message: 'Áudio e vídeo iniciados.',
  },
  [WorkflowEventType.SCREEN_SHARING_STARTED]: {
    category: DesktopLogCategory.SCREEN,
    message: 'Tela compartilhada.',
  },
  [WorkflowEventType.FAILED]: {
    category: DesktopLogCategory.ERROR,
    message: 'Falha no workflow de atendimento.',
    level: DesktopLogLevel.ERROR,
  },
};
