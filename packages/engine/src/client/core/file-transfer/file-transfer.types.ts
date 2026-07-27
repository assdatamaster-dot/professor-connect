export const FILE_TRANSFER_CHUNK_SIZE = 64 * 1024;

export type FileTransferDuplicateDecision = 'replace' | 'rename' | 'cancel';
export type FileTransferDirection = 'sent' | 'received';
export type FileTransferResult = 'completed' | 'cancelled' | 'failed' | 'rejected';

export interface FileTransferSelection {
  readonly transferId: string;
  readonly name: string;
  readonly size: number;
  readonly sha256: string;
  readonly chunkSize: number;
  readonly totalChunks: number;
}

export interface IncomingFileTransfer {
  readonly transferId: string;
  readonly name: string;
  readonly size: number;
  readonly sha256: string;
  readonly chunkSize: number;
  readonly totalChunks: number;
}

export interface PreparedIncomingFile {
  readonly accepted: boolean;
  readonly targetName?: string;
  readonly nextChunkIndex?: number;
}

export interface FileTransferChunk {
  readonly transferId: string;
  readonly index: number;
  readonly sha256: string;
  readonly bytes: Uint8Array;
}

export interface FileTransferVerification {
  readonly valid: boolean;
  readonly actualSha256: string;
  readonly badChunkIndexes: readonly number[];
  readonly destinationPath?: string;
}

export interface FileTransferAuditEntry {
  readonly transferId: string;
  readonly direction: FileTransferDirection;
  readonly origin: string;
  readonly destination: string;
  readonly peerName: string;
  readonly fileName: string;
  readonly size: number;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly averageBytesPerSecond: number;
  readonly sha256: string;
  readonly result: FileTransferResult;
  readonly error?: string;
}

export interface DuplicateFileContext {
  readonly fileName: string;
  readonly destinationPath: string;
}

export interface FileTransferStorageOptions {
  readonly documentsPath: string;
  readonly userDataPath: string;
  readonly selectFiles: () => Promise<readonly string[]>;
  readonly resolveDuplicate: (
    context: DuplicateFileContext,
  ) => Promise<FileTransferDuplicateDecision>;
  readonly idFactory?: () => string;
}
