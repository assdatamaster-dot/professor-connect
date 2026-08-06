import type { Server, Socket } from 'socket.io';

import type { FileTransferPersistence } from '../../persistence/persistence.types.js';
import type { SessionManager } from '../active-session/session.manager.js';
import type { CommunicationLogger } from '../communication/communication.types.js';

export const FILE_TRANSFER_AUDIT_EVENT = 'file-transfer:audit';

export interface FileTransferAuditPayload {
  readonly sessionId: string;
  readonly transferId: string;
  readonly direction: 'sent' | 'received';
  readonly fileName: string;
  readonly size: number;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly sha256: string;
  readonly averageBytesPerSecond: number;
  readonly result: 'completed' | 'cancelled' | 'failed' | 'rejected';
  readonly error?: string;
}

interface FileTransferClientEvents {
  [FILE_TRANSFER_AUDIT_EVENT]: (payload: FileTransferAuditPayload) => void;
}

type FileTransferServer = Server<FileTransferClientEvents>;
type FileTransferSocket = Socket<FileTransferClientEvents>;

export class FileTransferAuditGateway {
  public constructor(
    private readonly socketServer: FileTransferServer,
    private readonly sessionManager: SessionManager,
    private readonly persistence: FileTransferPersistence,
    private readonly logger: CommunicationLogger,
  ) {}

  public registerEvents(): void {
    this.socketServer.on('connection', (socket) => this.registerSocketEvents(socket));
  }

  private registerSocketEvents(socket: FileTransferSocket): void {
    socket.on(FILE_TRANSFER_AUDIT_EVENT, (payload) => {
      try {
        const audit = requireAudit(payload);
        if (audit.direction !== 'sent') return;
        const route = this.sessionManager.resolveSignalingRoute(audit.sessionId, socket.id);
        this.persistence.save({
          id: audit.transferId,
          sessionId: audit.sessionId,
          direction: route.senderRole === 'teacher' ? 'teacher-to-student' : 'student-to-teacher',
          fileName: audit.fileName,
          byteSize: BigInt(audit.size),
          checksum: audit.sha256,
          status: audit.result,
          ...(audit.error === undefined ? {} : { failureReason: audit.error }),
          averageBytesPerSecond: BigInt(Math.max(0, Math.round(audit.averageBytesPerSecond))),
          durationMilliseconds: BigInt(
            Math.max(0, Date.parse(audit.finishedAt) - Date.parse(audit.startedAt)),
          ),
          startedAt: new Date(audit.startedAt),
          completedAt: new Date(audit.finishedAt),
        });
        this.persistence.recordAudit?.({
          action: `file-transfer.${audit.result}`,
          actorType: route.senderRole,
          entityId: audit.transferId,
          severity:
            audit.result === 'failed' ? 'error' : audit.result === 'completed' ? 'info' : 'warning',
          metadata: {
            sessionId: audit.sessionId,
            fileName: audit.fileName,
            size: audit.size,
            averageBytesPerSecond: audit.averageBytesPerSecond,
            durationMilliseconds: Math.max(
              0,
              Date.parse(audit.finishedAt) - Date.parse(audit.startedAt),
            ),
            professor: route.session.teacherName,
            student: route.session.studentName,
            ...(audit.error === undefined ? {} : { error: audit.error }),
          },
        });
        this.sessionManager.markFeatureUsed(audit.sessionId, 'file-transfer');
        this.logger.info('Transferência de arquivo auditada', {
          sessionId: audit.sessionId,
          transferId: audit.transferId,
          result: audit.result,
        });
      } catch (error) {
        this.logger.error('Auditoria de transferência inválida', error);
      }
    });
  }
}

function requireAudit(value: unknown): FileTransferAuditPayload {
  if (typeof value !== 'object' || value === null) throw new Error('Payload inválido');
  const record = value as Readonly<Record<string, unknown>>;
  const direction = record.direction;
  const result = record.result;
  if (direction !== 'sent' && direction !== 'received') throw new Error('Direção inválida');
  if (
    result !== 'completed' &&
    result !== 'cancelled' &&
    result !== 'failed' &&
    result !== 'rejected'
  ) {
    throw new Error('Resultado inválido');
  }
  const size = record.size;
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) {
    throw new Error('Tamanho inválido');
  }
  const error = record.error;
  if (error !== undefined && typeof error !== 'string') throw new Error('Erro inválido');
  const averageBytesPerSecond = record.averageBytesPerSecond;
  if (
    typeof averageBytesPerSecond !== 'number' ||
    !Number.isFinite(averageBytesPerSecond) ||
    averageBytesPerSecond < 0
  ) {
    throw new Error('Velocidade média inválida');
  }
  return {
    sessionId: requireText(record.sessionId, 'sessionId'),
    transferId: requireText(record.transferId, 'transferId'),
    direction,
    fileName: requireText(record.fileName, 'fileName'),
    size,
    startedAt: requireDate(record.startedAt, 'startedAt'),
    finishedAt: requireDate(record.finishedAt, 'finishedAt'),
    sha256: requireText(record.sha256, 'sha256'),
    averageBytesPerSecond,
    result,
    ...(error === undefined ? {} : { error }),
  };
}

function requireText(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 512) {
    throw new Error(`${name} inválido`);
  }
  return value.trim();
}

function requireDate(value: unknown, name: string): string {
  const normalized = requireText(value, name);
  if (!Number.isFinite(Date.parse(normalized))) throw new Error(`${name} inválido`);
  return normalized;
}
