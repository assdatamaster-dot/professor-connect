import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';

import type {
  FileTransferAuditEntry,
  FileTransferChunk,
  FileTransferStorage,
  IncomingFileTransfer,
} from '@professor-connect/engine/file-transfer-node';

import { FILE_TRANSFER_IPC_CHANNELS } from '../shared/file-transfer-ipc-channels.js';

export interface FileTransferIpcRegistration {
  dispose(): void;
}

export function registerFileTransferIpc(
  storage: FileTransferStorage,
  renderer: WebContents,
): FileTransferIpcRegistration {
  const assertSender = (event: IpcMainInvokeEvent): void => {
    if (event.sender.id !== renderer.id) {
      throw new Error('Origem IPC não autorizada');
    }
  };

  ipcMain.handle(FILE_TRANSFER_IPC_CHANNELS.SELECT_FILES, (event) => {
    assertSender(event);
    return withFileTransferError(() => storage.selectFiles());
  });
  ipcMain.handle(
    FILE_TRANSFER_IPC_CHANNELS.READ_CHUNK,
    (event, transferId: unknown, index: unknown) => {
      assertSender(event);
      return withFileTransferError(() =>
        storage.readChunk(requireTransferId(transferId), requireChunkIndex(index)),
      );
    },
  );
  ipcMain.handle(FILE_TRANSFER_IPC_CHANNELS.VERIFY_SOURCE, (event, transferId: unknown) => {
    assertSender(event);
    return withFileTransferError(() => storage.verifySource(requireTransferId(transferId)));
  });
  ipcMain.handle(FILE_TRANSFER_IPC_CHANNELS.RELEASE_SOURCE, (event, transferId: unknown) => {
    assertSender(event);
    storage.releaseSource(requireTransferId(transferId));
  });
  ipcMain.handle(FILE_TRANSFER_IPC_CHANNELS.PREPARE_RECEIVE, (event, payload: unknown) => {
    assertSender(event);
    return withFileTransferError(() => storage.prepareReceive(requireMetadata(payload)));
  });
  ipcMain.handle(FILE_TRANSFER_IPC_CHANNELS.WRITE_CHUNK, (event, payload: unknown) => {
    assertSender(event);
    return withFileTransferError(() => storage.writeChunk(requireChunk(payload)));
  });
  ipcMain.handle(FILE_TRANSFER_IPC_CHANNELS.COMPLETE_RECEIVE, (event, transferId: unknown) => {
    assertSender(event);
    return withFileTransferError(() => storage.completeReceive(requireTransferId(transferId)));
  });
  ipcMain.handle(FILE_TRANSFER_IPC_CHANNELS.CANCEL_RECEIVE, (event, transferId: unknown) => {
    assertSender(event);
    return withFileTransferError(() => storage.cancelReceive(requireTransferId(transferId)));
  });
  ipcMain.handle(FILE_TRANSFER_IPC_CHANNELS.APPEND_AUDIT, (event, payload: unknown) => {
    assertSender(event);
    return withFileTransferError(() => storage.appendAudit(requireAudit(payload)));
  });

  return {
    dispose(): void {
      for (const channel of Object.values(FILE_TRANSFER_IPC_CHANNELS)) {
        ipcMain.removeHandler(channel);
      }
    },
  };
}

function requireMetadata(value: unknown): IncomingFileTransfer {
  const record = requireRecord(value);
  if (
    typeof record.name !== 'string' ||
    typeof record.size !== 'number' ||
    typeof record.sha256 !== 'string' ||
    typeof record.chunkSize !== 'number' ||
    typeof record.totalChunks !== 'number'
  ) {
    throw new Error('Metadados de arquivo inválidos');
  }
  return {
    transferId: requireTransferId(record.transferId),
    name: record.name,
    size: record.size,
    sha256: record.sha256,
    chunkSize: record.chunkSize,
    totalChunks: record.totalChunks,
  };
}

function requireChunk(value: unknown): FileTransferChunk {
  const record = requireRecord(value);
  if (typeof record.sha256 !== 'string') {
    throw new Error('Bloco de arquivo inválido');
  }
  return {
    transferId: requireTransferId(record.transferId),
    index: requireChunkIndex(record.index),
    sha256: record.sha256,
    bytes: requireBytes(record.bytes),
  };
}

function requireAudit(value: unknown): FileTransferAuditEntry {
  const record = requireRecord(value);
  if (
    (record.direction !== 'sent' && record.direction !== 'received') ||
    typeof record.origin !== 'string' ||
    typeof record.destination !== 'string' ||
    typeof record.peerName !== 'string' ||
    typeof record.fileName !== 'string' ||
    typeof record.size !== 'number' ||
    typeof record.startedAt !== 'string' ||
    typeof record.finishedAt !== 'string' ||
    typeof record.averageBytesPerSecond !== 'number' ||
    typeof record.sha256 !== 'string' ||
    (record.result !== 'completed' &&
      record.result !== 'cancelled' &&
      record.result !== 'failed' &&
      record.result !== 'rejected')
  ) {
    throw new Error('Registro de transferência inválido');
  }
  return {
    transferId: requireTransferId(record.transferId),
    direction: record.direction,
    origin: record.origin,
    destination: record.destination,
    peerName: record.peerName,
    fileName: record.fileName,
    size: record.size,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    averageBytesPerSecond: record.averageBytesPerSecond,
    sha256: record.sha256,
    result: record.result,
    ...(typeof record.error === 'string' ? { error: record.error } : {}),
  };
}

function requireTransferId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{8,128}$/u.test(value)) {
    throw new Error('Identificador de transferência inválido');
  }
  return value;
}

function requireChunkIndex(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error('Índice de bloco inválido');
  }
  return value;
}

function requireBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  throw new Error('Conteúdo do bloco inválido');
}

function requireRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Payload de transferência inválido');
  }
  return value as Readonly<Record<string, unknown>>;
}

async function withFileTransferError<TResult>(action: () => Promise<TResult>): Promise<TResult> {
  try {
    return await action();
  } catch (error) {
    if (isNodeError(error)) {
      if (error.code === 'ENOENT') {
        throw new Error('O arquivo não existe ou foi removido.', { cause: error });
      }
      if (error.code === 'EACCES' || error.code === 'EPERM') {
        throw new Error('Sem permissão para ler ou gravar o arquivo.', { cause: error });
      }
      if (error.code === 'ENOSPC') {
        throw new Error('Espaço insuficiente para concluir a transferência.', { cause: error });
      }
      if (error.code === 'EIO') {
        throw new Error('Falha de leitura ou gravação no dispositivo.', { cause: error });
      }
    }
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
