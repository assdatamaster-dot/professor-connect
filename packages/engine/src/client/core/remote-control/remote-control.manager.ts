import { EventType, type SocketMessage } from '@professor-connect/protocol';

import type { WebRtcLogger } from '../../../modules/webrtc/webrtc.types.js';
import { REMOTE_CONTROL_EVENTS } from './remote.events.js';
import {
  RemoteControlState,
  type CommandDispatcherPort,
  type PermissionManagerPort,
  type RemoteCommand,
  type RemoteCommandTransportPayload,
  type RemoteControlDataChannelPort,
  type RemoteControlManagerPort,
} from './remote.types.js';

const silentLogger: WebRtcLogger = {
  info(): void {},
  error(): void {},
};

export class RemoteControlManager implements RemoteControlManagerPort {
  public constructor(
    private readonly permissionManager: PermissionManagerPort,
    private readonly dispatcher: CommandDispatcherPort,
    private readonly dataChannel: RemoteControlDataChannelPort,
    private readonly logger: WebRtcLogger = silentLogger,
  ) {
    this.dataChannel.onEvent((callId, message) => {
      if (message.event === EventType.REMOTE_COMMAND) {
        void this.receiveCommand(callId, message);
      }
    });
  }

  public start(): void {
    const context = this.requireContext();

    if (!this.dataChannel.isOpen(context.callId)) {
      throw new Error(`DataChannel não está aberto: ${context.callId}`);
    }
    this.permissionManager.activate();
    this.logger.info('Sessão iniciada', {
      callId: context.callId,
      authorizationId: context.authorizationId,
    });
  }

  public stop(): void {
    const context = this.requireContext();

    this.permissionManager.revoke();
    this.logger.info('Sessão encerrada', {
      callId: context.callId,
      authorizationId: context.authorizationId,
    });
  }

  public expireRemote(): void {
    this.permissionManager.expireRemote();
    const context = this.requireContext();

    this.logger.info('Permissão expirada', {
      callId: context.callId,
      authorizationId: context.authorizationId,
    });
  }

  public fail(): void {
    this.permissionManager.fail();
  }

  public sendCommand(command: RemoteCommand): SocketMessage<RemoteCommandTransportPayload> {
    const context = this.requireActivePermission();

    try {
      const payload: RemoteCommandTransportPayload = {
        authorizationId: context.authorizationId,
        command: this.dispatcher.serialize(command),
      };
      const message = this.dataChannel.sendEvent(
        context.callId,
        REMOTE_CONTROL_EVENTS.command,
        payload,
      );

      this.logger.info('Comando enviado', {
        callId: context.callId,
        commandId: command.commandId,
        type: command.type,
      });
      return message;
    } catch (error) {
      this.permissionManager.fail();
      this.logger.error('Falhas', error);
      throw error;
    }
  }

  public getState(): RemoteControlState {
    return this.permissionManager.getState();
  }

  private async receiveCommand(callId: string, message: SocketMessage<unknown>): Promise<void> {
    const context = this.permissionManager.getContext();

    if (context === undefined || context.callId !== callId) {
      return;
    }

    try {
      this.requireActivePermission();
      if (message.sessionId !== context.sessionId || !isCommandTransportPayload(message.payload)) {
        throw new Error('Envelope de comando remoto inválido');
      }
      if (message.payload.authorizationId !== context.authorizationId) {
        throw new Error('Comando não pertence à autorização ativa');
      }

      const command = await this.dispatcher.dispatch(message.payload.command);

      this.logger.info('Comando recebido', {
        callId,
        commandId: command.commandId,
        type: command.type,
      });
    } catch (error) {
      this.permissionManager.fail();
      this.logger.error('Falhas', error);
    }
  }

  private requireActivePermission() {
    const context = this.requireContext();

    if (
      this.permissionManager.getState() !== RemoteControlState.ACTIVE ||
      !this.permissionManager.isAuthorized()
    ) {
      throw new Error('Sessão de controle remoto não está autorizada e ativa');
    }

    return context;
  }

  private requireContext() {
    const context = this.permissionManager.getContext();

    if (context === undefined) {
      throw new Error('Solicitação de controle remoto não encontrada');
    }

    return context;
  }
}

function isCommandTransportPayload(value: unknown): value is RemoteCommandTransportPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    'authorizationId' in value &&
    typeof value.authorizationId === 'string' &&
    'command' in value &&
    typeof value.command === 'string'
  );
}
