import type {
  ConnectionLifecyclePayload,
  ConnectionRecoveryPayload,
} from '@professor-connect/protocol';

import { HEARTBEAT_EVENTS } from './heartbeat.events.js';
import type { HeartbeatManager } from './heartbeat.manager.js';
import type {
  ConnectionRecoveryResources,
  HeartbeatClient,
  HeartbeatConnectionPort,
  HeartbeatLifecycleEvent,
  HeartbeatLifecycleListener,
  HeartbeatLogger,
  HeartbeatPresencePort,
  HeartbeatScheduler,
  HeartbeatSettings,
  ScheduledHeartbeatTask,
} from './heartbeat.types.js';

const silentLogger: HeartbeatLogger = {
  info(): void {},
  error(): void {},
};

const scheduleHeartbeat: HeartbeatScheduler = (task, intervalMilliseconds) => {
  const interval = setInterval(task, intervalMilliseconds);

  return {
    cancel(): void {
      clearInterval(interval);
    },
  };
};

export class HeartbeatService {
  private readonly listeners = new Set<HeartbeatLifecycleListener>();
  private scheduledTask: ScheduledHeartbeatTask | undefined;

  public constructor(
    private readonly heartbeatManager: HeartbeatManager,
    private readonly connectionPort: HeartbeatConnectionPort,
    private readonly presencePort: HeartbeatPresencePort,
    private readonly recoveryResources: ConnectionRecoveryResources,
    private readonly settings: HeartbeatSettings,
    private readonly logger: HeartbeatLogger = silentLogger,
    private readonly scheduler: HeartbeatScheduler = scheduleHeartbeat,
  ) {
    this.validateSettings();
  }

  public start(): void {
    if (this.scheduledTask !== undefined) {
      return;
    }

    this.scheduledTask = this.scheduler(() => this.runCycle(), this.settings.intervalMs);
  }

  public stop(): void {
    this.scheduledTask?.cancel();
    this.scheduledTask = undefined;
    this.listeners.clear();
  }

  public registerClient(clientId: string, connectionId: string): HeartbeatClient {
    return this.heartbeatManager.registerClient(clientId, connectionId);
  }

  public recordHeartbeat(connectionId: string): HeartbeatClient {
    const client = this.heartbeatManager.recordHeartbeat(connectionId);

    if (client === undefined) {
      throw new Error(`Heartbeat recebido de conexão não registrada: ${connectionId}`);
    }

    this.connectionPort.recordHeartbeat(connectionId);
    this.presencePort.updateLastSeenByConnection(connectionId);
    this.logger.info('Heartbeat recebido', { clientId: client.clientId, connectionId });

    return client;
  }

  public markConnectionLost(connectionId: string): HeartbeatClient | undefined {
    const client = this.heartbeatManager.markConnectionLost(connectionId);

    if (client === undefined) {
      return undefined;
    }

    this.connectionPort.markLost(connectionId);
    this.presencePort.markConnectionLost(connectionId);
    this.logger.info('Cliente inativo', { clientId: client.clientId, connectionId });
    this.emitLifecycle({
      event: HEARTBEAT_EVENTS.lost,
      payload: this.createLifecyclePayload(client),
    });

    return client;
  }

  public recoverClient(
    clientId: string,
    connectionId: string,
  ): ConnectionRecoveryPayload | undefined {
    const previousClient = this.heartbeatManager.findClient(clientId);
    const recoveredClient = this.heartbeatManager.recoverClient(clientId, connectionId);

    if (recoveredClient === undefined || previousClient === undefined) {
      const timedOutClient = this.heartbeatManager.timeoutIfExpired(clientId);

      if (timedOutClient !== undefined) {
        this.handleTimeout(timedOutClient);
      }

      return undefined;
    }

    this.logger.info('Reconexão', {
      clientId,
      previousConnectionId: previousClient.connectionId,
      connectionId,
    });
    this.connectionPort.recoverConnection(previousClient.connectionId, connectionId);
    const presence = this.presencePort.recoverClient(clientId, connectionId);
    const sessions = this.recoveryResources.replaceSessionConnection(
      previousClient.connectionId,
      connectionId,
    );
    const payload: ConnectionRecoveryPayload = {
      ...this.createLifecyclePayload(recoveredClient),
      previousConnectionId: previousClient.connectionId,
      presence,
      sessions,
      requests: this.recoveryResources.listPendingRequests(clientId),
      calls: this.recoveryResources.listActiveCalls(clientId),
    };

    this.logger.info('Recuperação concluída', { clientId, connectionId });
    this.emitLifecycle({ event: HEARTBEAT_EVENTS.recovered, payload });

    return payload;
  }

  public runCycle(): void {
    const inspection = this.heartbeatManager.inspectConnections();

    for (const client of inspection.inactiveClients) {
      this.connectionPort.markInactive(client.connectionId);
      this.logger.info('Cliente inativo', {
        clientId: client.clientId,
        connectionId: client.connectionId,
      });
    }

    for (const client of inspection.timedOutClients) {
      this.handleTimeout(client);
    }

    for (const client of inspection.pingClients) {
      this.logger.info('Heartbeat enviado', {
        clientId: client.clientId,
        connectionId: client.connectionId,
      });
      this.emitLifecycle({
        event: HEARTBEAT_EVENTS.ping,
        connectionId: client.connectionId,
      });
    }
  }

  public findClient(clientId: string): HeartbeatClient | undefined {
    return this.heartbeatManager.findClient(clientId);
  }

  public listClients(): readonly HeartbeatClient[] {
    return this.heartbeatManager.listClients();
  }

  public onLifecycle(listener: HeartbeatLifecycleListener): () => void {
    this.listeners.add(listener);

    return () => this.listeners.delete(listener);
  }

  private handleTimeout(client: HeartbeatClient): void {
    this.connectionPort.timeoutConnection(client.connectionId);
    this.presencePort.timeoutClient(client.clientId);
    this.recoveryResources.releaseSessions(client.connectionId);
    this.logger.info('Timeout', {
      clientId: client.clientId,
      connectionId: client.connectionId,
    });
    this.emitLifecycle({
      event: HEARTBEAT_EVENTS.timeout,
      payload: this.createLifecyclePayload(client),
    });
    this.heartbeatManager.removeClient(client.clientId);
  }

  private createLifecyclePayload(client: HeartbeatClient): ConnectionLifecyclePayload {
    return {
      clientId: client.clientId,
      connectionId: client.connectionId,
      connectionState: client.connectionState,
      lastSeen: client.lastSeen,
    };
  }

  private emitLifecycle(event: HeartbeatLifecycleEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        this.logger.error('Falha ao emitir evento de heartbeat', error);
      }
    }
  }

  private validateSettings(): void {
    if (
      !Number.isInteger(this.settings.intervalMs) ||
      !Number.isInteger(this.settings.timeoutMs) ||
      !Number.isInteger(this.settings.reconnectWindowMs) ||
      this.settings.intervalMs <= 0 ||
      this.settings.timeoutMs <= this.settings.intervalMs ||
      this.settings.reconnectWindowMs <= 0 ||
      this.settings.reconnectWindowMs > this.settings.timeoutMs
    ) {
      throw new Error('Configuração de heartbeat inválida');
    }
  }
}
