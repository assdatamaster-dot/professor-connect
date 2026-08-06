import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import {
  FILE_TRANSFER_CHUNK_SIZE,
  FileTransferStorage,
  type FileTransferDuplicateDecision,
  type IncomingFileTransfer,
} from '../src/file-transfer-node.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe('FileTransferStorage', () => {
  it('seleciona múltiplos formatos, calcula SHA-256 e nunca lê além de um chunk', async () => {
    const root = await createTemporaryRoot();
    const extensions = ['pdf', 'docx', 'xlsx', 'zip', 'png', 'jpg', 'mp4'];
    const selectedPaths: string[] = [];
    for (const [index, extension] of extensions.entries()) {
      const filePath = path.join(root, `arquivo-${index}.${extension}`);
      await writeFile(filePath, Buffer.alloc(FILE_TRANSFER_CHUNK_SIZE + index + 1, index));
      selectedPaths.push(filePath);
    }
    let sequence = 0;
    const storage = createStorage(root, selectedPaths, () => `transfer-format-${sequence++}`);

    const selections = await storage.selectFiles();

    assert.deepEqual(
      selections.map((selection) => path.extname(selection.name)),
      extensions.map((extension) => `.${extension}`),
    );
    for (const selection of selections) {
      const first = await storage.readChunk(selection.transferId, 0);
      const last = await storage.readChunk(selection.transferId, selection.totalChunks - 1);
      assert.equal(first.bytes.byteLength, FILE_TRANSFER_CHUNK_SIZE);
      assert.ok(last.bytes.byteLength <= FILE_TRANSFER_CHUNK_SIZE);
      assert.match(selection.sha256, /^[a-f0-9]{64}$/u);
      assert.match(first.sha256, /^[a-f0-9]{64}$/u);
    }
  });

  it('prepara 100 MB, 500 MB, 1 GB e mais de 1 GB sem alocar o arquivo em memória', async () => {
    const root = await createTemporaryRoot();
    const storage = createStorage(root, []);
    const sizes = [100 * 1024 ** 2, 500 * 1024 ** 2, 1024 ** 3, 1280 * 1024 ** 2];

    for (const [index, size] of sizes.entries()) {
      const metadata = metadataFor(`transfer-large-${index}`, `grande-${index}.zip`, size);
      const prepared = await storage.prepareReceive(metadata);
      assert.equal(prepared.accepted, true);
      assert.equal(prepared.nextChunkIndex, 0);
      await storage.cancelReceive(metadata.transferId);
    }
  });

  it('transfere em chunks, valida cada bloco e conclui com SHA-256 idêntico', async () => {
    const root = await createTemporaryRoot();
    const sourcePath = path.join(root, 'origem.bin');
    const sourceBytes = Buffer.alloc(FILE_TRANSFER_CHUNK_SIZE * 3 + 17);
    for (let index = 0; index < sourceBytes.length; index += 1) {
      sourceBytes[index] = index % 251;
    }
    await writeFile(sourcePath, sourceBytes);
    const sender = createStorage(
      path.join(root, 'sender'),
      [sourcePath],
      () => 'transfer-complete',
    );
    const receiverRoot = path.join(root, 'receiver');
    const receiver = createStorage(receiverRoot, []);
    const [metadata] = await sender.selectFiles();
    assert.ok(metadata);
    await receiver.prepareReceive(metadata);

    for (let index = 0; index < metadata.totalChunks; index += 1) {
      const chunk = await sender.readChunk(metadata.transferId, index);
      assert.equal(await receiver.writeChunk(chunk), index + 1);
    }
    const verification = await receiver.completeReceive(metadata.transferId);

    assert.equal(verification.valid, true);
    assert.equal(verification.actualSha256, metadata.sha256);
    assert.deepEqual(
      await readFile(path.join(receiver.getReceiveDirectory(), metadata.name)),
      sourceBytes,
    );
  });

  it('retoma do último chunk persistido após interrupção', async () => {
    const root = await createTemporaryRoot();
    const sourcePath = path.join(root, 'retomada.zip');
    await writeFile(sourcePath, Buffer.alloc(FILE_TRANSFER_CHUNK_SIZE * 4 + 9, 37));
    const sender = createStorage(path.join(root, 'sender'), [sourcePath], () => 'transfer-resume');
    const receiverRoot = path.join(root, 'receiver');
    const receiverBeforeInterruption = createStorage(receiverRoot, []);
    const [metadata] = await sender.selectFiles();
    assert.ok(metadata);
    await receiverBeforeInterruption.prepareReceive(metadata);
    await receiverBeforeInterruption.writeChunk(await sender.readChunk(metadata.transferId, 0));
    await receiverBeforeInterruption.writeChunk(await sender.readChunk(metadata.transferId, 1));

    const receiverAfterInterruption = createStorage(receiverRoot, []);
    const resumed = await receiverAfterInterruption.prepareReceive(metadata);

    assert.equal(resumed.nextChunkIndex, 2);
    for (let index = resumed.nextChunkIndex ?? 0; index < metadata.totalChunks; index += 1) {
      await receiverAfterInterruption.writeChunk(
        await sender.readChunk(metadata.transferId, index),
      );
    }
    assert.equal(
      (await receiverAfterInterruption.completeReceive(metadata.transferId)).valid,
      true,
    );
  });

  it('mantém duas transferências simultâneas isoladas', async () => {
    const root = await createTemporaryRoot();
    const firstPath = path.join(root, 'primeiro.png');
    const secondPath = path.join(root, 'segundo.mp4');
    await writeFile(firstPath, Buffer.alloc(FILE_TRANSFER_CHUNK_SIZE * 2 + 3, 17));
    await writeFile(secondPath, Buffer.alloc(FILE_TRANSFER_CHUNK_SIZE * 3 + 5, 29));
    let sequence = 0;
    const sender = createStorage(
      path.join(root, 'sender'),
      [firstPath, secondPath],
      () => `transfer-parallel-${sequence++}`,
    );
    const receiver = createStorage(path.join(root, 'receiver'), []);
    const selections = await sender.selectFiles();
    for (const metadata of selections) {
      await receiver.prepareReceive(metadata);
    }

    const maximumChunks = Math.max(...selections.map((metadata) => metadata.totalChunks));
    for (let index = 0; index < maximumChunks; index += 1) {
      for (const metadata of selections) {
        if (index < metadata.totalChunks) {
          await receiver.writeChunk(await sender.readChunk(metadata.transferId, index));
        }
      }
    }

    for (const metadata of selections) {
      assert.equal((await receiver.completeReceive(metadata.transferId)).valid, true);
    }
  });

  it('recusa bloco corrompido e permite reenviar somente o bloco necessário', async () => {
    const root = await createTemporaryRoot();
    const sourcePath = path.join(root, 'integridade.pdf');
    await writeFile(sourcePath, Buffer.alloc(FILE_TRANSFER_CHUNK_SIZE + 23, 11));
    const sender = createStorage(
      path.join(root, 'sender'),
      [sourcePath],
      () => 'transfer-integrity',
    );
    const receiver = createStorage(path.join(root, 'receiver'), []);
    const [metadata] = await sender.selectFiles();
    assert.ok(metadata);
    await receiver.prepareReceive(metadata);
    const validChunk = await sender.readChunk(metadata.transferId, 0);
    const corruptedBytes = validChunk.bytes.slice();
    corruptedBytes[0] = (corruptedBytes[0] ?? 0) ^ 0xff;

    await assert.rejects(
      receiver.writeChunk({ ...validChunk, bytes: corruptedBytes }),
      /integridade/u,
    );
    assert.equal(await receiver.writeChunk(validChunk), 1);
  });

  it('aplica substituir, renomear automaticamente e cancelar para arquivos duplicados', async () => {
    const root = await createTemporaryRoot();
    let decision: FileTransferDuplicateDecision = 'rename';
    const storage = createStorage(root, [], undefined, () => decision);
    const receiveDirectory = storage.getReceiveDirectory();
    await writeFile(
      path.join(await ensureDirectory(receiveDirectory), 'duplicado.txt'),
      'existente',
    );

    const renamed = await storage.prepareReceive(
      metadataFor('transfer-rename', 'duplicado.txt', 0),
    );
    assert.equal(renamed.targetName, 'duplicado (1).txt');
    await storage.cancelReceive('transfer-rename');

    decision = 'cancel';
    const cancelled = await storage.prepareReceive(
      metadataFor('transfer-cancel', 'duplicado.txt', 0),
    );
    assert.equal(cancelled.accepted, false);

    decision = 'replace';
    const replacedMetadata = metadataFor('transfer-replace', 'duplicado.txt', 0);
    const replaced = await storage.prepareReceive(replacedMetadata);
    assert.equal(replaced.targetName, 'duplicado.txt');
    assert.equal((await storage.completeReceive(replacedMetadata.transferId)).valid, true);
    assert.equal((await stat(path.join(receiveDirectory, 'duplicado.txt'))).size, 0);
  });

  it('cria a pasta padrão, persiste preferências e mantém histórico local', async () => {
    const root = await createTemporaryRoot();
    const storage = createStorage(root, []);
    const defaults = await storage.getSettings();

    assert.equal(defaults.autoReceive, true);
    assert.equal(
      defaults.destinationDirectory,
      path.join(root, 'documents', 'Professor Connect', 'Recebidos'),
    );
    assert.equal((await stat(defaults.destinationDirectory)).isDirectory(), true);

    const customDirectory = path.join(root, 'custom-received');
    await storage.updateSettings({ autoReceive: false, destinationDirectory: customDirectory });
    await storage.appendAudit({
      transferId: 'transfer-history',
      direction: 'received',
      origin: 'Professor',
      destination: 'Aluno',
      peerName: 'Professor',
      fileName: 'aula.pdf',
      size: 123,
      startedAt: '2026-08-06T12:00:00.000Z',
      finishedAt: '2026-08-06T12:00:01.000Z',
      averageBytesPerSecond: 123,
      sha256: 'a'.repeat(64),
      result: 'completed',
      destinationPath: path.join(customDirectory, 'aula.pdf'),
    });

    const restored = createStorage(root, []);
    assert.deepEqual(await restored.getSettings(), {
      autoReceive: false,
      destinationDirectory: customDirectory,
    });
    assert.equal((await restored.listHistory())[0]?.fileName, 'aula.pdf');
  });
});

function createStorage(
  root: string,
  selectedPaths: readonly string[],
  idFactory: (() => string) | undefined = () => 'transfer-default',
  duplicateDecision: () => FileTransferDuplicateDecision = () => 'rename',
): FileTransferStorage {
  return new FileTransferStorage({
    documentsPath: path.join(root, 'documents'),
    userDataPath: path.join(root, 'user-data'),
    selectFiles: async () => selectedPaths,
    resolveDuplicate: async () => duplicateDecision(),
    ...(idFactory === undefined ? {} : { idFactory }),
  });
}

function metadataFor(transferId: string, name: string, size: number): IncomingFileTransfer {
  return {
    transferId,
    name,
    size,
    sha256: createHash('sha256').update(new Uint8Array()).digest('hex'),
    chunkSize: FILE_TRANSFER_CHUNK_SIZE,
    totalChunks: Math.ceil(size / FILE_TRANSFER_CHUNK_SIZE),
  };
}

async function createTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'professor-connect-file-transfer-'));
  temporaryDirectories.push(root);
  return root;
}

async function ensureDirectory(directory: string): Promise<string> {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(directory, { recursive: true });
  return directory;
}
