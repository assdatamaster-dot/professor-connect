export type FileTransferStatus =
  | 'waiting'
  | 'sending'
  | 'receiving'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'rejected';

export interface FileTransferMetadata {
  readonly transferId: string;
  readonly name: string;
  readonly size: number;
  readonly sha256: string;
  readonly chunkSize: number;
  readonly totalChunks: number;
}

export interface FileTransferChunkPayload {
  readonly transferId: string;
  readonly index: number;
  readonly sha256: string;
  readonly bytes: Uint8Array;
}

export interface PreparedIncomingFile {
  readonly accepted: boolean;
  readonly targetName?: string;
  readonly nextChunkIndex?: number;
}

export interface FileTransferVerification {
  readonly valid: boolean;
  readonly actualSha256: string;
  readonly badChunkIndexes: readonly number[];
  readonly destinationPath?: string;
}

export interface FileTransferAuditPayload {
  readonly transferId: string;
  readonly direction: 'sent' | 'received';
  readonly origin: string;
  readonly destination: string;
  readonly peerName: string;
  readonly fileName: string;
  readonly size: number;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly averageBytesPerSecond: number;
  readonly sha256: string;
  readonly result: 'completed' | 'cancelled' | 'failed' | 'rejected';
  readonly destinationPath?: string;
  readonly error?: string;
}

export interface FileTransferSettings {
  readonly autoReceive: boolean;
  readonly destinationDirectory: string;
}

export interface FileTransferApi {
  selectFiles(): Promise<readonly FileTransferMetadata[]>;
  selectDroppedFiles(files: readonly File[]): Promise<readonly FileTransferMetadata[]>;
  readChunk(transferId: string, index: number): Promise<FileTransferChunkPayload>;
  verifySource(transferId: string): Promise<boolean>;
  releaseSource(transferId: string): Promise<void>;
  prepareReceive(metadata: FileTransferMetadata): Promise<PreparedIncomingFile>;
  writeChunk(payload: FileTransferChunkPayload): Promise<number>;
  completeReceive(transferId: string): Promise<FileTransferVerification>;
  cancelReceive(transferId: string): Promise<void>;
  appendAudit(payload: FileTransferAuditPayload): Promise<void>;
  listHistory(): Promise<readonly FileTransferAuditPayload[]>;
  getSettings(): Promise<FileTransferSettings>;
  updateSettings(update: Partial<FileTransferSettings>): Promise<FileTransferSettings>;
  chooseDestinationDirectory(): Promise<FileTransferSettings | undefined>;
  openFile(filePath: string): Promise<void>;
  openDirectory(directoryPath?: string): Promise<void>;
}
