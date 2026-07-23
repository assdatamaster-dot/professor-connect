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
import type { RemoteMouseControllerPort } from './remote-mouse/remote-mouse.controller.js';

const MAXIMUM_LOG_ENTRIES = 100;

type RemoteControlListener = (snapshot: StudentRemoteControlSnapshot) => void;

export interface RemoteControlReceiverOptions {
  readonly clock?: () => Date;
  readonly idFactory?: () => string;
  readonly mouseController?: RemoteMouseControllerPort;
}

export class RemoteControlReceiver {
  private readonly listeners = new Set<RemoteControlListener>();
  private readonly clock: () => Date;
  private readonly idFactory: () => string;
  private readonly mouseController: RemoteMouseControllerPort;
  private snapshot: StudentRemoteControlSnapshot = createInitialSnapshot();

  public constructor(options: RemoteControlReceiverOptions = {}) {
    this.clock = options.clock ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
    this.mouseController = options.mouseController ?? unavailableMouseController;
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
      this.mouseController.start(reference);
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
      logs: this.appendLog('Solicitação aceita'),
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
    try {
      const message = this.mouseController.receive(payload.event);
      if (message !== undefined) {
        this.recordReceivedEvent(message);
      }
      return undefined;
    } catch (error) {
      const stopped: RemoteControlStopPayload = {
        sessionId: payload.sessionId,
        requestId: payload.requestId,
        reason: 'execution-error',
      };
      this.snapshot = {
        ...this.snapshot,
        logs: this.appendLog(`Erro de execução: ${getErrorMessage(error)}`),
      };
      this.stopLocally();
      return stopped;
    }
  }

  public receiveKeyboard(payload: RemoteControlKeyboardPayload): void {
    this.requireActiveReference(payload);
    this.recordReceivedEvent(
      payload.event.type === 'keydown'
        ? 'KeyDown (somente log, não executado)'
        : 'KeyUp (somente log, não executado)',
    );
  }

  public receiveStop(payload: RemoteControlStopPayload): void {
    if (
      this.snapshot.sessionId !== payload.sessionId ||
      this.snapshot.requestId !== payload.requestId
    ) {
      return;
    }
    this.stopLocally();
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
    this.mouseController.stop();
    this.snapshot = createInitialSnapshot();
    this.notifyListeners();
  }

  public onStateChanged(listener: RemoteControlListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public dispose(): void {
    this.mouseController.stop();
    this.listeners.clear();
    this.snapshot = createInitialSnapshot();
  }

  private recordReceivedEvent(eventName: string): void {
    this.snapshot = {
      ...this.snapshot,
      logs: this.appendLog(`Evento recebido: ${eventName}`),
    };
    this.notifyListeners();
  }

  private stopLocally(): void {
    this.mouseController.stop();
    this.snapshot = {
      status: 'inactive',
      sessionId: undefined,
      requestId: undefined,
      logs: this.appendLog('Controle encerrado'),
    };
    this.notifyListeners();
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
