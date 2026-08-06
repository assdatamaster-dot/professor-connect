import { createHash } from 'node:crypto';
import {
  appendFile,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  statfs,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import {
  FILE_TRANSFER_CHUNK_SIZE,
  type FileTransferAuditEntry,
  type FileTransferChunk,
  type FileTransferSelection,
  FILE_TRANSFER_MAX_SIZE,
  type FileTransferSettings,
  type FileTransferStorageOptions,
  type FileTransferVerification,
  type IncomingFileTransfer,
  type PreparedIncomingFile,
} from './file-transfer.types.js';

interface RegisteredSource extends FileTransferSelection {
  readonly sourcePath: string;
}

interface ReceiveRecord extends IncomingFileTransfer {
  readonly finalPath: string;
  readonly targetName: string;
  readonly partPath: string;
  readonly metadataPath: string;
  readonly hashesPath: string;
  readonly replaceExisting: boolean;
  nextChunkIndex: number;
}

interface PersistedReceiveRecord extends IncomingFileTransfer {
  readonly finalPath: string;
  readonly targetName: string;
  readonly partPath: string;
  readonly hashesPath: string;
  readonly replaceExisting: boolean;
}

const SHA_256_BYTES = 32;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const TRANSFER_ID_PATTERN = /^[a-zA-Z0-9-]{8,128}$/u;

export class FileTransferStorage {
  private receiveDirectory: string;
  private readonly auditLogPath: string;
  private readonly settingsPath: string;
  private readonly sources = new Map<string, RegisteredSource>();
  private readonly receives = new Map<string, ReceiveRecord>();

  public constructor(private readonly options: FileTransferStorageOptions) {
    const baseDirectory = options.downloadsPath ?? options.documentsPath;
    if (baseDirectory === undefined) {
      throw new Error('A pasta de Downloads precisa ser configurada');
    }
    this.receiveDirectory = path.join(baseDirectory, 'Professor Connect', 'Recebidos');
    this.auditLogPath = path.join(options.userDataPath, 'file-transfers.jsonl');
    this.settingsPath = path.join(options.userDataPath, 'file-transfer-settings.json');
  }

  public async selectFiles(): Promise<readonly FileTransferSelection[]> {
    return this.registerFiles(await this.options.selectFiles());
  }

  public async registerFiles(
    selectedPaths: readonly string[],
  ): Promise<readonly FileTransferSelection[]> {
    const selections: FileTransferSelection[] = [];

    for (const sourcePath of selectedPaths) {
      const sourceStat = await stat(sourcePath);
      if (!sourceStat.isFile()) {
        throw new Error(`O item selecionado não é um arquivo: ${path.basename(sourcePath)}`);
      }
      if (!Number.isSafeInteger(sourceStat.size) || sourceStat.size < 0) {
        throw new Error(`O arquivo excede o tamanho suportado: ${path.basename(sourcePath)}`);
      }
      if (sourceStat.size > FILE_TRANSFER_MAX_SIZE) {
        throw new Error(`O arquivo excede o limite de 5 GB: ${path.basename(sourcePath)}`);
      }

      const transferId = this.createTransferId();
      const selection: RegisteredSource = {
        transferId,
        sourcePath,
        name: sanitizeFileName(path.basename(sourcePath)),
        size: sourceStat.size,
        sha256: await hashFile(sourcePath),
        chunkSize: FILE_TRANSFER_CHUNK_SIZE,
        totalChunks: Math.ceil(sourceStat.size / FILE_TRANSFER_CHUNK_SIZE),
      };
      this.sources.set(transferId, selection);
      selections.push(toPublicSelection(selection));
    }

    return selections;
  }

  public async readChunk(transferId: string, index: number): Promise<FileTransferChunk> {
    const source = this.requireSource(transferId);
    assertChunkIndex(index, source.totalChunks);
    const position = index * source.chunkSize;
    const expectedLength = Math.min(source.chunkSize, source.size - position);
    const handle = await open(source.sourcePath, 'r');

    try {
      const buffer = Buffer.allocUnsafe(expectedLength);
      const { bytesRead } = await handle.read(buffer, 0, expectedLength, position);
      if (bytesRead !== expectedLength) {
        throw new Error(`Falha de leitura: bloco ${index + 1} de ${source.name} está incompleto`);
      }
      const bytes = new Uint8Array(
        buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + bytesRead),
      );
      return {
        transferId,
        index,
        sha256: hashBytes(bytes),
        bytes,
      };
    } finally {
      await handle.close();
    }
  }

  public releaseSource(transferId: string): void {
    this.sources.delete(transferId);
  }

  public async verifySource(transferId: string): Promise<boolean> {
    const source = this.requireSource(transferId);
    const sourceStat = await stat(source.sourcePath);
    return sourceStat.size === source.size && (await hashFile(source.sourcePath)) === source.sha256;
  }

  public async prepareReceive(metadata: IncomingFileTransfer): Promise<PreparedIncomingFile> {
    validateIncomingMetadata(metadata);
    await this.loadSettings();
    await mkdir(this.receiveDirectory, { recursive: true });
    await this.assertFreeSpace(metadata.size);

    const safeName = sanitizeFileName(metadata.name);
    const partial = this.partialPaths(metadata.transferId);
    const resumed = await this.tryResume(metadata, partial.metadataPath);
    if (resumed !== undefined) {
      resumed.nextChunkIndex = await this.findNextChunkIndex(resumed, 0);
      this.receives.set(metadata.transferId, resumed);
      return {
        accepted: true,
        targetName: resumed.targetName,
        nextChunkIndex: resumed.nextChunkIndex,
      };
    }

    await this.removePartialFiles(partial);
    let targetName = safeName;
    let finalPath = path.join(this.receiveDirectory, targetName);
    let replaceExisting = false;

    if (await fileExists(finalPath)) {
      const decision = await this.options.resolveDuplicate({
        fileName: safeName,
        destinationPath: finalPath,
      });
      if (decision === 'cancel') {
        return { accepted: false };
      }
      if (decision === 'rename') {
        targetName = await createAvailableName(this.receiveDirectory, safeName);
        finalPath = path.join(this.receiveDirectory, targetName);
      } else {
        replaceExisting = true;
      }
    }

    const record: ReceiveRecord = {
      ...metadata,
      name: safeName,
      targetName,
      finalPath,
      partPath: partial.partPath,
      metadataPath: partial.metadataPath,
      hashesPath: partial.hashesPath,
      replaceExisting,
      nextChunkIndex: 0,
    };
    await writeFile(record.partPath, new Uint8Array());
    await writeFile(record.hashesPath, new Uint8Array());
    await this.persistReceive(record);
    this.receives.set(metadata.transferId, record);
    return { accepted: true, targetName, nextChunkIndex: 0 };
  }

  public async writeChunk(chunk: FileTransferChunk): Promise<number> {
    const receive = this.requireReceive(chunk.transferId);
    assertChunkIndex(chunk.index, receive.totalChunks);
    if (!SHA_256_PATTERN.test(chunk.sha256) || hashBytes(chunk.bytes) !== chunk.sha256) {
      throw new Error(`Falha de integridade no bloco ${chunk.index + 1}`);
    }

    const position = chunk.index * receive.chunkSize;
    const expectedLength = Math.min(receive.chunkSize, receive.size - position);
    if (chunk.bytes.byteLength !== expectedLength) {
      throw new Error(`Bloco ${chunk.index + 1} possui tamanho inválido`);
    }

    const fileHandle = await open(receive.partPath, 'r+');
    const hashHandle = await open(receive.hashesPath, 'r+');
    try {
      await fileHandle.write(chunk.bytes, 0, chunk.bytes.byteLength, position);
      const digest = Buffer.from(chunk.sha256, 'hex');
      await hashHandle.write(digest, 0, digest.byteLength, chunk.index * SHA_256_BYTES);
    } finally {
      await Promise.all([fileHandle.close(), hashHandle.close()]);
    }

    if (chunk.index === receive.nextChunkIndex) {
      receive.nextChunkIndex = await this.findNextChunkIndex(receive, receive.nextChunkIndex);
    }
    return receive.nextChunkIndex;
  }

  public async completeReceive(transferId: string): Promise<FileTransferVerification> {
    const receive = this.requireReceive(transferId);
    const badChunkIndexes = await this.findBadChunks(receive);
    const actualSha256 = badChunkIndexes.length === 0 ? await hashFile(receive.partPath) : '';

    if (badChunkIndexes.length > 0 || actualSha256 !== receive.sha256) {
      return {
        valid: false,
        actualSha256,
        badChunkIndexes:
          badChunkIndexes.length > 0
            ? badChunkIndexes
            : Array.from({ length: receive.totalChunks }, (_value, index) => index),
      };
    }

    if (receive.replaceExisting && (await fileExists(receive.finalPath))) {
      const backupPath = `${receive.finalPath}.pc-backup-${receive.transferId}`;
      await rename(receive.finalPath, backupPath);
      try {
        await rename(receive.partPath, receive.finalPath);
        await rm(backupPath, { force: true });
      } catch (error) {
        await rename(backupPath, receive.finalPath).catch(() => undefined);
        throw error;
      }
    } else {
      await rename(receive.partPath, receive.finalPath);
    }
    await Promise.all([
      rm(receive.metadataPath, { force: true }),
      rm(receive.hashesPath, { force: true }),
    ]);
    this.receives.delete(transferId);
    return {
      valid: true,
      actualSha256,
      badChunkIndexes: [],
      destinationPath: receive.finalPath,
    };
  }

  public async cancelReceive(transferId: string): Promise<void> {
    const receive = this.receives.get(transferId);
    if (receive === undefined) {
      return;
    }
    this.receives.delete(transferId);
    await this.removePartialFiles(receive);
  }

  public async appendAudit(entry: FileTransferAuditEntry): Promise<void> {
    await mkdir(path.dirname(this.auditLogPath), { recursive: true });
    await appendFile(this.auditLogPath, `${JSON.stringify(entry)}\n`, 'utf8');
  }

  public async listHistory(limit = 200): Promise<readonly FileTransferAuditEntry[]> {
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
    try {
      const entries = (await readFile(this.auditLogPath, 'utf8'))
        .split(/\r?\n/u)
        .filter((line) => line.trim().length > 0)
        .flatMap((line) => {
          try {
            return [JSON.parse(line) as FileTransferAuditEntry];
          } catch {
            return [];
          }
        });
      return entries.slice(-safeLimit).reverse();
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return [];
      throw error;
    }
  }

  public async getSettings(): Promise<FileTransferSettings> {
    await this.loadSettings();
    await mkdir(this.receiveDirectory, { recursive: true });
    return { autoReceive: this.autoReceive, destinationDirectory: this.receiveDirectory };
  }

  public async updateSettings(
    update: Partial<Pick<FileTransferSettings, 'autoReceive' | 'destinationDirectory'>>,
  ): Promise<FileTransferSettings> {
    await this.loadSettings();
    if (update.autoReceive !== undefined) this.autoReceive = update.autoReceive;
    if (update.destinationDirectory !== undefined) {
      if (!path.isAbsolute(update.destinationDirectory)) {
        throw new Error('A pasta de destino precisa ser absoluta');
      }
      this.receiveDirectory = path.resolve(update.destinationDirectory);
    }
    await mkdir(this.receiveDirectory, { recursive: true });
    await mkdir(path.dirname(this.settingsPath), { recursive: true });
    await writeFile(
      this.settingsPath,
      JSON.stringify({
        autoReceive: this.autoReceive,
        destinationDirectory: this.receiveDirectory,
      }),
      'utf8',
    );
    return { autoReceive: this.autoReceive, destinationDirectory: this.receiveDirectory };
  }

  public getReceiveDirectory(): string {
    return this.receiveDirectory;
  }

  private autoReceive = true;
  private settingsLoaded = false;

  private async loadSettings(): Promise<void> {
    if (this.settingsLoaded) return;
    this.settingsLoaded = true;
    try {
      const parsed = JSON.parse(await readFile(this.settingsPath, 'utf8')) as {
        readonly autoReceive?: unknown;
        readonly destinationDirectory?: unknown;
      };
      if (typeof parsed.autoReceive === 'boolean') this.autoReceive = parsed.autoReceive;
      if (
        typeof parsed.destinationDirectory === 'string' &&
        path.isAbsolute(parsed.destinationDirectory)
      ) {
        this.receiveDirectory = path.resolve(parsed.destinationDirectory);
      }
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'ENOENT') {
        this.settingsLoaded = true;
      }
    }
  }

  private createTransferId(): string {
    const value = this.options.idFactory?.() ?? globalThis.crypto.randomUUID();
    if (!TRANSFER_ID_PATTERN.test(value)) {
      throw new Error('Identificador de transferência inválido');
    }
    return value;
  }

  private requireSource(transferId: string): RegisteredSource {
    const source = this.sources.get(transferId);
    if (source === undefined) {
      throw new Error('Arquivo de origem não está mais disponível');
    }
    return source;
  }

  private requireReceive(transferId: string): ReceiveRecord {
    const receive = this.receives.get(transferId);
    if (receive === undefined) {
      throw new Error('Transferência de destino não foi preparada');
    }
    return receive;
  }

  private partialPaths(transferId: string): {
    readonly partPath: string;
    readonly metadataPath: string;
    readonly hashesPath: string;
  } {
    if (!TRANSFER_ID_PATTERN.test(transferId)) {
      throw new Error('Identificador de transferência inválido');
    }
    const base = path.join(this.receiveDirectory, `.pc-transfer-${transferId}`);
    return {
      partPath: `${base}.part`,
      metadataPath: `${base}.json`,
      hashesPath: `${base}.sha256`,
    };
  }

  private async tryResume(
    metadata: IncomingFileTransfer,
    metadataPath: string,
  ): Promise<ReceiveRecord | undefined> {
    if (!(await fileExists(metadataPath))) {
      return undefined;
    }
    try {
      const persisted = JSON.parse(await readFile(metadataPath, 'utf8')) as PersistedReceiveRecord;
      if (
        persisted.transferId !== metadata.transferId ||
        persisted.name !== sanitizeFileName(metadata.name) ||
        persisted.size !== metadata.size ||
        persisted.sha256 !== metadata.sha256 ||
        persisted.chunkSize !== metadata.chunkSize ||
        persisted.totalChunks !== metadata.totalChunks ||
        !isPathInside(this.receiveDirectory, persisted.finalPath) ||
        !isPathInside(this.receiveDirectory, persisted.partPath) ||
        !isPathInside(this.receiveDirectory, persisted.hashesPath) ||
        !(await fileExists(persisted.partPath)) ||
        !(await fileExists(persisted.hashesPath))
      ) {
        return undefined;
      }
      return { ...persisted, metadataPath, nextChunkIndex: 0 };
    } catch {
      return undefined;
    }
  }

  private async persistReceive(receive: ReceiveRecord): Promise<void> {
    const persisted: PersistedReceiveRecord = {
      transferId: receive.transferId,
      name: receive.name,
      size: receive.size,
      sha256: receive.sha256,
      chunkSize: receive.chunkSize,
      totalChunks: receive.totalChunks,
      finalPath: receive.finalPath,
      targetName: receive.targetName,
      partPath: receive.partPath,
      hashesPath: receive.hashesPath,
      replaceExisting: receive.replaceExisting,
    };
    await writeFile(receive.metadataPath, JSON.stringify(persisted), 'utf8');
  }

  private async findNextChunkIndex(receive: ReceiveRecord, startIndex: number): Promise<number> {
    const hashesStat = await stat(receive.hashesPath);
    const partStat = await stat(receive.partPath);
    const possible = Math.min(
      receive.totalChunks,
      Math.floor(hashesStat.size / SHA_256_BYTES),
      Math.ceil(partStat.size / receive.chunkSize),
    );
    if (possible <= startIndex) {
      return startIndex;
    }

    const handle = await open(receive.hashesPath, 'r');
    try {
      const digest = Buffer.alloc(SHA_256_BYTES);
      for (let index = startIndex; index < possible; index += 1) {
        const { bytesRead } = await handle.read(digest, 0, SHA_256_BYTES, index * SHA_256_BYTES);
        if (bytesRead !== SHA_256_BYTES || digest.every((value) => value === 0)) {
          return index;
        }
      }
      return possible;
    } finally {
      await handle.close();
    }
  }

  private async findBadChunks(receive: ReceiveRecord): Promise<number[]> {
    const bad: number[] = [];
    const hashesHandle = await open(receive.hashesPath, 'r');
    const fileHandle = await open(receive.partPath, 'r');
    try {
      for (let index = 0; index < receive.totalChunks; index += 1) {
        const position = index * receive.chunkSize;
        const expectedLength = Math.min(receive.chunkSize, receive.size - position);
        const bytes = Buffer.allocUnsafe(expectedLength);
        const expectedHash = Buffer.alloc(SHA_256_BYTES);
        const [{ bytesRead }, { bytesRead: hashBytesRead }] = await Promise.all([
          fileHandle.read(bytes, 0, expectedLength, position),
          hashesHandle.read(expectedHash, 0, SHA_256_BYTES, index * SHA_256_BYTES),
        ]);
        if (
          bytesRead !== expectedLength ||
          hashBytesRead !== SHA_256_BYTES ||
          hashBytes(bytes) !== expectedHash.toString('hex')
        ) {
          bad.push(index);
        }
      }
    } finally {
      await Promise.all([hashesHandle.close(), fileHandle.close()]);
    }
    return bad;
  }

  private async assertFreeSpace(size: number): Promise<void> {
    const info = await statfs(this.receiveDirectory);
    const available = BigInt(info.bavail) * BigInt(info.bsize);
    if (available < BigInt(size)) {
      throw new Error('Espaço insuficiente para receber o arquivo');
    }
  }

  private async removePartialFiles(paths: {
    readonly partPath: string;
    readonly metadataPath: string;
    readonly hashesPath: string;
  }): Promise<void> {
    await Promise.all([
      rm(paths.partPath, { force: true }),
      rm(paths.metadataPath, { force: true }),
      rm(paths.hashesPath, { force: true }),
    ]);
  }
}

function validateIncomingMetadata(metadata: IncomingFileTransfer): void {
  if (
    !TRANSFER_ID_PATTERN.test(metadata.transferId) ||
    !Number.isSafeInteger(metadata.size) ||
    metadata.size < 0 ||
    metadata.size > FILE_TRANSFER_MAX_SIZE ||
    !SHA_256_PATTERN.test(metadata.sha256) ||
    metadata.chunkSize !== FILE_TRANSFER_CHUNK_SIZE ||
    metadata.totalChunks !== Math.ceil(metadata.size / metadata.chunkSize)
  ) {
    throw new Error('Metadados de transferência inválidos');
  }
  sanitizeFileName(metadata.name);
}

function sanitizeFileName(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > 240 ||
    path.basename(trimmed) !== trimmed ||
    /[<>:"/\\|?*]/u.test(trimmed) ||
    containsControlCharacter(trimmed) ||
    trimmed === '.' ||
    trimmed === '..'
  ) {
    throw new Error('Nome de arquivo inválido');
  }
  return trimmed;
}

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => character.charCodeAt(0) <= 0x1f);
}

function assertChunkIndex(index: number, totalChunks: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= totalChunks) {
    throw new Error('Índice de bloco inválido');
  }
}

async function hashFile(filePath: string): Promise<string> {
  const handle = await open(filePath, 'r');
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let position = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, position);
      if (bytesRead === 0) {
        break;
      }
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    return hash.digest('hex');
  } finally {
    await handle.close();
  }
}

function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function toPublicSelection(source: RegisteredSource): FileTransferSelection {
  return {
    transferId: source.transferId,
    name: source.name,
    size: source.size,
    sha256: source.sha256,
    chunkSize: source.chunkSize,
    totalChunks: source.totalChunks,
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function createAvailableName(directory: string, originalName: string): Promise<string> {
  const extension = path.extname(originalName);
  const baseName = path.basename(originalName, extension);
  for (let suffix = 1; suffix <= 10_000; suffix += 1) {
    const candidate = `${baseName} (${suffix})${extension}`;
    if (!(await fileExists(path.join(directory, candidate)))) {
      return candidate;
    }
  }
  throw new Error('Não foi possível gerar um nome disponível para o arquivo');
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function isPathInside(directory: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(directory), path.resolve(candidate));
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}
