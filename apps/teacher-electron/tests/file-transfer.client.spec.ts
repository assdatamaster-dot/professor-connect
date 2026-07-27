import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  decodeFileTransferFrame,
  encodeFileTransferFrame,
} from '../renderer/file-transfer.client.js';

describe('protocolo binário de transferência', () => {
  it('mantém identificador, índice, hash e bytes de transferências simultâneas', () => {
    const hashA = 'a'.repeat(64);
    const hashB = 'b'.repeat(64);
    const frameA = encodeFileTransferFrame(
      { transferId: 'transfer-simultaneous-a', index: 7, sha256: hashA },
      new Uint8Array([1, 2, 3]),
    );
    const frameB = encodeFileTransferFrame(
      { transferId: 'transfer-simultaneous-b', index: 2, sha256: hashB },
      new Uint8Array([9, 8]),
    );

    assert.deepEqual(decodeFileTransferFrame(frameA), {
      header: { transferId: 'transfer-simultaneous-a', index: 7, sha256: hashA },
      bytes: new Uint8Array([1, 2, 3]),
    });
    assert.deepEqual(decodeFileTransferFrame(frameB), {
      header: { transferId: 'transfer-simultaneous-b', index: 2, sha256: hashB },
      bytes: new Uint8Array([9, 8]),
    });
  });

  it('rejeita frame truncado ou cabeçalho adulterado', () => {
    assert.throws(() => decodeFileTransferFrame(new Uint8Array([1, 2, 3]).buffer), /truncado/u);

    const invalid = new Uint8Array(12);
    new DataView(invalid.buffer).setUint32(0, 2048, true);
    assert.throws(() => decodeFileTransferFrame(invalid.buffer), /Cabeçalho/u);
  });
});
