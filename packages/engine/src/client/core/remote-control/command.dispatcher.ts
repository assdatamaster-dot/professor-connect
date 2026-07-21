import type { WebRtcLogger } from '../../../modules/webrtc/webrtc.types.js';
import {
  RemoteCommandType,
  RemoteMouseButton,
  type CommandDispatcherPort,
  type RemoteCommand,
  type RemoteCommandExecutorPort,
} from './remote.types.js';

const silentLogger: WebRtcLogger = {
  info(): void {},
  error(): void {},
};

export class LoggingRemoteCommandExecutor implements RemoteCommandExecutorPort {
  public constructor(private readonly logger: WebRtcLogger = silentLogger) {}

  public execute(command: RemoteCommand): void {
    this.logger.info('Comando recebido', {
      commandId: command.commandId,
      type: command.type,
    });
  }
}

export class CommandDispatcher implements CommandDispatcherPort {
  public constructor(
    private readonly executor: RemoteCommandExecutorPort = new LoggingRemoteCommandExecutor(),
    private readonly logger: WebRtcLogger = silentLogger,
  ) {}

  public serialize(command: RemoteCommand): string {
    if (!isRemoteCommand(command)) {
      throw new Error('Comando remoto inválido');
    }

    return JSON.stringify(command);
  }

  public deserialize(serialized: string): RemoteCommand {
    if (serialized.trim().length === 0) {
      throw new Error('Comando remoto serializado é obrigatório');
    }

    const parsed: unknown = JSON.parse(serialized);

    if (!isRemoteCommand(parsed)) {
      throw new Error('Comando remoto possui estrutura inválida');
    }

    return parsed;
  }

  public async dispatch(serialized: string): Promise<RemoteCommand> {
    try {
      const command = this.deserialize(serialized);

      await this.executor.execute(command);
      return command;
    } catch (error) {
      this.logger.error('Falhas', error);
      throw error;
    }
  }
}

function isRemoteCommand(value: unknown): value is RemoteCommand {
  if (
    !isRecord(value) ||
    typeof value.commandId !== 'string' ||
    value.commandId.trim().length === 0 ||
    typeof value.type !== 'string' ||
    !isCommandType(value.type) ||
    typeof value.timestamp !== 'string' ||
    Number.isNaN(Date.parse(value.timestamp)) ||
    !isRecord(value.payload)
  ) {
    return false;
  }

  switch (value.type) {
    case RemoteCommandType.MOUSE_MOVE:
      return isFiniteNumber(value.payload.x) && isFiniteNumber(value.payload.y);
    case RemoteCommandType.MOUSE_DOWN:
    case RemoteCommandType.MOUSE_UP:
      return typeof value.payload.button === 'string' && isMouseButton(value.payload.button);
    case RemoteCommandType.MOUSE_WHEEL:
      return isFiniteNumber(value.payload.deltaX) && isFiniteNumber(value.payload.deltaY);
    case RemoteCommandType.KEY_DOWN:
    case RemoteCommandType.KEY_UP:
      return (
        typeof value.payload.code === 'string' &&
        value.payload.code.trim().length > 0 &&
        typeof value.payload.key === 'string' &&
        typeof value.payload.repeat === 'boolean'
      );
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isCommandType(value: string): value is RemoteCommandType {
  return (Object.values(RemoteCommandType) as readonly string[]).includes(value);
}

function isMouseButton(value: string): value is RemoteMouseButton {
  return (Object.values(RemoteMouseButton) as readonly string[]).includes(value);
}
