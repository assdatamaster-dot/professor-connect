import { mkdtemp, mkdir, rm, truncate, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  FILE_TRANSFER_CHUNK_SIZE,
  FileTransferStorage,
} from '../packages/engine/dist/file-transfer-node.js';

const FILE_SIZE = 100 * 1024 * 1024;
const root = await mkdtemp(path.join(os.tmpdir(), 'professor-connect-beta-7a-'));
const sourcePath = path.join(root, 'arquivo-100mb.zip');
const startedAt = Date.now();
const initialRss = process.memoryUsage().rss;
let peakRss = initialRss;

try {
  await writeFile(sourcePath, new Uint8Array());
  await truncate(sourcePath, FILE_SIZE);
  const sender = new FileTransferStorage({
    documentsPath: path.join(root, 'sender-documents'),
    userDataPath: path.join(root, 'sender-data'),
    selectFiles: async () => [sourcePath],
    resolveDuplicate: async () => 'rename',
    idFactory: () => 'transfer-audit-100mb',
  });
  const receiver = new FileTransferStorage({
    documentsPath: path.join(root, 'receiver-documents'),
    userDataPath: path.join(root, 'receiver-data'),
    selectFiles: async () => [],
    resolveDuplicate: async () => 'rename',
  });
  const [metadata] = await sender.selectFiles();
  if (metadata === undefined) {
    throw new Error('O arquivo de auditoria não foi selecionado');
  }
  await receiver.prepareReceive(metadata);

  for (let index = 0; index < metadata.totalChunks; index += 1) {
    await receiver.writeChunk(await sender.readChunk(metadata.transferId, index));
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }
  const verification = await receiver.completeReceive(metadata.transferId);
  const finishedAt = Date.now();
  const result = {
    fileSizeBytes: FILE_SIZE,
    chunkSizeBytes: FILE_TRANSFER_CHUNK_SIZE,
    totalChunks: metadata.totalChunks,
    sha256: metadata.sha256,
    destinationSha256: verification.actualSha256,
    integrityValid: verification.valid,
    elapsedMilliseconds: finishedAt - startedAt,
    averageMegabytesPerSecond:
      FILE_SIZE / 1024 / 1024 / Math.max(0.001, (finishedAt - startedAt) / 1000),
    initialRssBytes: initialRss,
    peakRssBytes: peakRss,
    rssGrowthBytes: peakRss - initialRss,
    completedAt: new Date(finishedAt).toISOString(),
  };
  await mkdir(path.resolve('auditorias'), { recursive: true });
  await writeFile(
    path.resolve('auditorias', 'beta-7a-file-transfer.json'),
    `${JSON.stringify(result, null, 2)}\n`,
    'utf8',
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await rm(root, { recursive: true, force: true });
}
