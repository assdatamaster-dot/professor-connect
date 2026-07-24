import { randomUUID } from 'node:crypto';

import type {
  RemoteControlApproved,
  RemoteControlDenied,
  RemoteControlKeyboardPayload,
  RemoteControlMousePayload,
  RemoteControlRequest,
  RemoteControlStopPayload,
} from '@professor-connect/protocol';

import type {
  RemoteControlLogEntry,
  StudentRemoteControlSnapshot,
} from '../shared/remote-control-contracts.js';
import type { RemoteKeyboardControllerPort } from './remote-keyboard/remote-keyboard.controller.js';
import {
  RemoteInputController,
  type RemoteInputControllerPort,
} from './remote-input/remote-input.controller.js';
import type { RemoteMouseControllerPort } from './remote-mouse/remote-mouse.controller.js';

const MAXIMUM_LOG_ENTRIES = 100;

type RemoteControlListener = (snapshot: StudentRemoteControlSnapshot) => void;

export interface RemoteControlReceiverOptions {
  readonly clock?: () => Date;
  readonly idFactory?: () => string;
  readonly inputController?: RemoteInputControllerPort;
  /** @deprecated Use inputController. Mantido para integrações da Beta-5B. */
  readonly mouseController?: RemoteMouseControllerPort;
}

export class RemoteControlReceiver {
  private readonly listeners = new Set<RemoteControlListener>();
  private readonly clock: () => Date;
  private readonly idFactory: () => string;
  private readonly inputController: RemoteInputControllerPort;
  private snapshot: StudentRemoteControlSnapshot = createInitialSnapshot();

  public constructor(options: RemoteControlReceiverOptions = {}) {
    this.clock = options.clock ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
    this.inputController =
      options.inputController ??
      new RemoteInputController(
        options.mouseController ?? unavailableMouseController,
        passiveKeyboardController,
      );
  }

  public getSnapshot(): StudentRemoteControlSnapshot {
    return { ...this.snapshot, logs: [...this.snapshot.logs] };
  }

  public receiveRequest(payload: RemoteControlRequest, activeSessionId: string | undefined): void {
    requireActiveSession(payload.sessionId, activeSessionId);
    if (this.snapshot.status !== 'inactive') {
      throw new Error('Já existe uma solicitação de controle remoto');
    }
    this.snapshot = {
      status: 'pending',
      sessionId: payload.sessionId,
      requestId: payload.requestId,
      logs: this.appendLog('Solicitação recebida'),
    };
    this.notifyListeners();
  }

  public approve(activeSessionId: string | undefined): RemoteControlApproved {
    const reference = this.requirePendingReference(activeSessionId);
    try {
      this.inputController.start(reference);
    } catch (error) {
      this.snapshot = {
        ...this.snapshot,
        logs: this.appendLog(`Erro de execução: ${getErrorMessage(error)}`),
      };
      this.notifyListeners();
      throw error;
    }
    this.snapshot = {
      ...this.snapshot,
      status: 'active',
      logs: appendLogEntry(
        this.appendLog('Solicitação aceita'),
        'Controle iniciado',
        this.clock,
        this.idFactory,
      ),
    };
    this.notifyListeners();
    return reference;
  }

  public deny(activeSessionId: string | undefined): RemoteControlDenied {
    const reference = this.requirePendingReference(activeSessionId);
    this.snapshot = {
      status: 'inactive',
      sessionId: undefined,
      requestId: undefined,
      logs: this.appendLog('Solicitação negada'),
    };
    this.notifyListeners();
    return reference;
  }

  public receiveMouse(payload: RemoteControlMousePayload): RemoteControlStopPayload | undefined {
    this.requireActiveReference(payload);
    return this.executeInput(payload, () => {
      const message = this.inputController.receiveMouse(payload, payload.event);
      return message === undefined ? [] : [message];
    });
  }

  public receiveKeyboard(
    payload: RemoteControlKeyboardPayload,
  ): RemoteControlStopPayload | undefined {
    this.requireActiveReference(payload);
    return this.executeInput(payload, () =>
      this.inputController.receiveKeyboard(payload, payload.event),
    );
  }

  public receiveStop(payload: RemoteControlStopPayload): void {
    if (
      this.snapshot.sessionId !== payload.sessionId ||
      this.snapshot.requestId !== payload.requestId
    ) {
      return;
    }
    this.stopLocally(`Controle encerrado: ${payload.reason}`);
  }

  public stop(activeSessionId: string | undefined): RemoteControlStopPayload {
    const reference = this.requireCurrentReference(activeSessionId);
    this.stopLocally();
    return { ...reference, reason: 'participant' };
  }

  public endSession(sessionId: string): void {
    if (this.snapshot.sessionId === sessionId) {
      this.stopLocally();
    }
  }

  public handleTransportLoss(): void {
    if (this.snapshot.status !== 'inactive') {
      this.stopLocally();
    }
  }

  public reset(): void {
    this.inputController.stop();
    this.snapshot = createInitialSnapshot();
    this.notifyListeners();
  }

  public onStateChanged(listener: RemoteControlListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public dispose(): void {
    this.inputController.stop();
    this.listeners.clear();
    this.snapshot = createInitialSnapshot();
  }

  private recordReceivedEvents(eventNames: readonly string[]): void {
    if (eventNames.length === 0) {
      return;
    }
    this.snapshot = {
      ...this.snapshot,
      logs: eventNames.reduce(
        (logs, eventName) =>
          appendLogEntry(logs, `Evento recebido: ${eventName}`, this.clock, this.idFactory),
        this.snapshot.logs,
      ),
    };
    this.notifyListeners();
  }

  private stopLocally(message = 'Controle encerrado'): void {
    this.inputController.stop();
    this.snapshot = {
      status: 'inactive',
      sessionId: undefined,
      requestId: undefined,
      logs: this.appendLog(message),
    };
    this.notifyListeners();
  }

  private executeInput(
    reference: RemoteControlRequest,
    action: () => readonly string[],
  ): RemoteControlStopPayload | undefined {
    try {
      this.recordReceivedEvents(action());
      return undefined;
    } catch (error) {
      this.snapshot = {
        ...this.snapshot,
        logs: this.appendLog(`Erro de execução: ${getErrorMessage(error)}`),
      };
      this.stopLocally();
      return { ...reference, reason: 'execution-error' };
    }
  }

  private requirePendingReference(activeSessionId: string | undefined): RemoteControlRequest {
    if (this.snapshot.status !== 'pending') {
      throw new Error('Não há solicitação de controle remoto pendente');
    }
    return this.requireCurrentReference(activeSessionId);
  }

  private requireActiveReference(reference: RemoteControlRequest): void {
    if (
      this.snapshot.status !== 'active' ||
      this.snapshot.sessionId !== reference.sessionId ||
      this.snapshot.requestId !== reference.requestId
    ) {
      throw new Error('Evento recebido sem autorização ativa');
    }
  }

  private requireCurrentReference(activeSessionId: string | undefined): RemoteControlRequest {
    const { sessionId, requestId } = this.snapshot;
    if (sessionId === undefined || requestId === undefined || sessionId !== activeSessionId) {
      throw new Error('Controle remoto não pertence à sessão ativa');
    }
    return { sessionId, requestId };
  }

  private appendLog(message: string): readonly RemoteControlLogEntry[] {
    return [
      ...this.snapshot.logs,
      {
        id: this.idFactory(),
        timestamp: this.clock().toISOString(),
        message,
      },
    ].slice(-MAXIMUM_LOG_ENTRIES);
  }

  private notifyListeners(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

function createInitialSnapshot(): StudentRemoteControlSnapshot {
  return {
    status: 'inactive',
    sessionId: undefined,
    requestId: undefined,
    logs: [],
  };
}

function requireActiveSession(sessionId: string, activeSessionId: string | undefined): void {
  if (activeSessionId === undefined || sessionId !== activeSessionId) {
    throw new Error('Solicitação não pertence à sessão ativa');
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'falha desconhecida';
}

function appendLogEntry(
  logs: readonly RemoteControlLogEntry[],
  message: string,
  clock: () => Date,
  idFactory: () => string,
): readonly RemoteControlLogEntry[] {
  return [
    ...logs,
    {
      id: idFactory(),
      timestamp: clock().toISOString(),
      message,
    },
  ].slice(-MAXIMUM_LOG_ENTRIES);
}

const unavailableMouseController: RemoteMouseControllerPort = {
  start(): void {
    throw new Error('Executor nativo do mouse não está disponível');
  },
  receive(): undefined {
    throw new Error('Executor nativo do mouse não está disponível');
  },
  stop(): void {
    return;
  },
  isActive(): boolean {
    return false;
  },
};

const passiveKeyboardController: RemoteKeyboardControllerPort = {
  start(): void {
    return;
  },
  receive(event): readonly string[] {
    return [
      event.type === 'keydown'
        ? `KeyDown: ${event.key}`
        : event.type === 'keyup'
          ? `KeyUp: ${event.key}`
          : `KeyPress: ${event.key}`,
    ];
  },
  stop(): void {
    return;
  },
  isActive(): boolean {
    return true;
  },
};
