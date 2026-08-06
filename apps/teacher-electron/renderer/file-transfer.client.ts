import type {
  FileTransferApi,
  FileTransferAuditPayload,
  FileTransferMetadata,
  FileTransferSettings,
  FileTransferStatus,
} from '../shared/file-transfer-contracts.js';

export const FILE_TRANSFER_DATA_CHANNEL_LABEL = 'professor-connect-files-v1';

const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
const MAX_IN_FLIGHT_CHUNKS = 16;
const FRAME_HEADER_LIMIT = 1024;

interface FileTransferClientElements {
  readonly button: HTMLButtonElement;
  readonly panel: HTMLElement;
  readonly list: HTMLUListElement;
  readonly dropZone: HTMLElement;
  readonly destination: HTMLElement;
  readonly autoReceive: HTMLInputElement;
  readonly changeDestination: HTMLButtonElement;
}

export interface FileTransferClientOptions {
  readonly api: FileTransferApi;
  readonly elements: FileTransferClientElements;
  readonly getLocalName: () => string;
  readonly notify: (message: string) => void;
  readonly onIncoming?: () => void;
}

interface TransferState {
  readonly metadata: FileTransferMetadata;
  readonly direction: 'sent' | 'received';
  startedAt: string;
  peerName: string;
  status: FileTransferStatus;
  transferredBytes: number;
  nextChunkIndex: number;
  acknowledgedChunkIndex: number;
  targetName?: string;
  error?: string;
  pumping: boolean;
  completionSent: boolean;
  auditWritten: boolean;
  destinationPath?: string;
}

type ControlMessage =
  | {
      readonly type: 'request';
      readonly senderName: string;
      readonly metadata: FileTransferMetadata;
    }
  | {
      readonly type: 'accept';
      readonly transferId: string;
      readonly nextChunkIndex: number;
      readonly targetName: string;
    }
  | { readonly type: 'reject'; readonly transferId: string }
  | { readonly type: 'ack'; readonly transferId: string; readonly nextChunkIndex: number }
  | { readonly type: 'complete'; readonly transferId: string }
  | { readonly type: 'verified'; readonly transferId: string; readonly sha256: string }
  | { readonly type: 'retry'; readonly transferId: string; readonly indexes: readonly number[] }
  | { readonly type: 'retry-complete'; readonly transferId: string }
  | { readonly type: 'cancel'; readonly transferId: string }
  | { readonly type: 'error'; readonly transferId: string; readonly message: string };

export interface BinaryFrameHeader {
  readonly transferId: string;
  readonly index: number;
  readonly sha256: string;
}

export class FileTransferClient {
  private readonly transfers = new Map<string, TransferState>();
  private channel: RTCDataChannel | undefined;
  private sessionId: string | undefined;
  private peerName = 'Participante';
  private receiveQueue = Promise.resolve();
  private settings: FileTransferSettings = { autoReceive: true, destinationDirectory: '' };
  private settingsReady: Promise<void>;
  private selectedTab: 'sent' | 'received' | 'history' = 'sent';
  private history: readonly FileTransferAuditPayload[] = [];
  private readonly renderTimer: number;

  public constructor(private readonly options: FileTransferClientOptions) {
    options.elements.button.addEventListener('click', this.handleSelectFiles);
    options.elements.list.addEventListener('click', this.handleListAction);
    options.elements.panel.addEventListener('click', this.handlePanelAction);
    options.elements.dropZone.addEventListener('dragenter', this.handleDragEnter);
    options.elements.dropZone.addEventListener('dragover', this.handleDragEnter);
    options.elements.dropZone.addEventListener('dragleave', this.handleDragLeave);
    options.elements.dropZone.addEventListener('drop', this.handleDrop);
    options.elements.autoReceive.addEventListener('change', this.handleAutoReceiveChange);
    options.elements.changeDestination.addEventListener('click', this.handleChangeDestination);
    this.settingsReady = this.loadSettings();
    this.renderTimer = window.setInterval(() => this.render(), 1_000);
    this.render();
  }

  public beginSession(sessionId: string, peerName: string): void {
    if (this.sessionId !== undefined && this.sessionId !== sessionId) {
      void this.clearTransfers();
    }
    this.sessionId = sessionId;
    this.peerName = peerName.trim() || 'Participante';
    this.render();
  }

  public attachChannel(channel: RTCDataChannel): void {
    if (channel.label !== FILE_TRANSFER_DATA_CHANNEL_LABEL) {
      channel.close();
      return;
    }
    this.detachChannel();
    this.channel = channel;
    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = 1024 * 1024;
    channel.onopen = () => this.handleChannelOpen(channel);
    channel.onclose = () => this.handleChannelClose(channel);
    channel.onerror = () => {
      this.options.notify('A conexão de transferência de arquivos apresentou uma falha.');
    };
    channel.onmessage = (event) => {
      this.receiveQueue = this.receiveQueue
        .then(() => this.handleWireMessage(event.data))
        .catch((error: unknown) => {
          this.options.notify(toErrorMessage(error, 'Falha ao processar arquivo recebido.'));
        });
    };
    if (channel.readyState === 'open') {
      this.handleChannelOpen(channel);
    }
    this.render();
  }

  public detachChannel(): void {
    const channel = this.channel;
    if (channel !== undefined) {
      channel.onopen = null;
      channel.onclose = null;
      channel.onerror = null;
      channel.onmessage = null;
    }
    this.channel = undefined;
    for (const transfer of this.transfers.values()) {
      if (transfer.status === 'sending' || transfer.status === 'receiving') {
        transfer.status = 'paused';
      }
      transfer.pumping = false;
    }
    this.render();
  }

  public endSession(): void {
    this.detachChannel();
    this.sessionId = undefined;
    void this.clearTransfers();
  }

  public dispose(): void {
    this.endSession();
    this.options.elements.button.removeEventListener('click', this.handleSelectFiles);
    this.options.elements.list.removeEventListener('click', this.handleListAction);
    this.options.elements.panel.removeEventListener('click', this.handlePanelAction);
    this.options.elements.dropZone.removeEventListener('dragenter', this.handleDragEnter);
    this.options.elements.dropZone.removeEventListener('dragover', this.handleDragEnter);
    this.options.elements.dropZone.removeEventListener('dragleave', this.handleDragLeave);
    this.options.elements.dropZone.removeEventListener('drop', this.handleDrop);
    this.options.elements.autoReceive.removeEventListener('change', this.handleAutoReceiveChange);
    this.options.elements.changeDestination.removeEventListener(
      'click',
      this.handleChangeDestination,
    );
    window.clearInterval(this.renderTimer);
  }

  private readonly handleSelectFiles = (): void => {
    if (!this.isChannelOpen()) {
      this.options.notify('Aguarde a conexão com o outro participante para transferir arquivos.');
      return;
    }
    this.options.elements.button.disabled = true;
    void this.options.api
      .selectFiles()
      .then((files) => this.enqueueFiles(files))
      .catch((error: unknown) => {
        this.options.notify(toErrorMessage(error, 'Não foi possível selecionar os arquivos.'));
      })
      .finally(() => this.render());
  };

  private readonly handleDragEnter = (event: DragEvent): void => {
    event.preventDefault();
    if (this.isChannelOpen()) this.options.elements.dropZone.classList.add('is-dragging');
  };

  private readonly handleDragLeave = (event: DragEvent): void => {
    event.preventDefault();
    if (event.type === 'dragleave') this.options.elements.dropZone.classList.remove('is-dragging');
  };

  private readonly handleDrop = (event: DragEvent): void => {
    event.preventDefault();
    this.options.elements.dropZone.classList.remove('is-dragging');
    if (!this.isChannelOpen()) {
      this.options.notify('A transferência fica disponível durante um atendimento conectado.');
      return;
    }
    const files = [...(event.dataTransfer?.files ?? [])];
    if (files.length === 0) return;
    void this.options.api
      .selectDroppedFiles(files)
      .then((metadata) => this.enqueueFiles(metadata))
      .catch((error: unknown) =>
        this.options.notify(
          toErrorMessage(error, 'Não foi possível enviar os arquivos arrastados.'),
        ),
      );
  };

  private readonly handlePanelAction = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    const tab = target.dataset.transferTab;
    if (tab === 'sent' || tab === 'received' || tab === 'history') {
      this.selectedTab = tab;
      if (tab === 'history') void this.loadHistory();
      this.render();
    }
  };

  private readonly handleAutoReceiveChange = (): void => {
    const autoReceive = this.options.elements.autoReceive.checked;
    void this.options.api.updateSettings({ autoReceive }).then((settings) => {
      this.settings = settings;
      this.renderSettings();
    });
  };

  private readonly handleChangeDestination = (): void => {
    void this.options.api.chooseDestinationDirectory().then((settings) => {
      if (settings !== undefined) {
        this.settings = settings;
        this.renderSettings();
      }
    });
  };

  private enqueueFiles(files: readonly FileTransferMetadata[]): void {
    for (const metadata of files) {
      const transfer: TransferState = {
        metadata,
        direction: 'sent',
        peerName: this.peerName,
        status: 'waiting',
        transferredBytes: 0,
        nextChunkIndex: 0,
        acknowledgedChunkIndex: 0,
        startedAt: new Date().toISOString(),
        pumping: false,
        completionSent: false,
        auditWritten: false,
      };
      this.transfers.set(metadata.transferId, transfer);
      this.sendRequest(transfer);
    }
    this.selectedTab = 'sent';
    this.render();
  }

  private readonly handleListAction = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) {
      return;
    }
    const transferId = target.dataset.transferId;
    const action = target.dataset.action;
    if (transferId === undefined) {
      return;
    }
    if (action === 'accept') {
      void this.acceptIncoming(transferId);
    } else if (action === 'reject') {
      void this.rejectIncoming(transferId);
    } else if (action === 'cancel') {
      void this.cancelTransfer(transferId);
    } else if (action === 'retry') {
      this.retryTransfer(transferId);
    } else if (action === 'open') {
      const transfer = this.transfers.get(transferId);
      const filePath = transfer?.destinationPath ?? target.dataset.filePath;
      if (filePath !== undefined) {
        void this.options.api.openFile(filePath);
      }
    } else if (action === 'folder') {
      void this.options.api.openDirectory();
    } else if (action === 'close') {
      this.transfers.delete(transferId);
      this.render();
    }
  };

  private handleChannelOpen(channel: RTCDataChannel): void {
    if (this.channel !== channel) {
      return;
    }
    for (const transfer of this.transfers.values()) {
      if (
        transfer.direction === 'sent' &&
        transfer.status !== 'completed' &&
        transfer.status !== 'cancelled' &&
        transfer.status !== 'rejected' &&
        transfer.status !== 'failed'
      ) {
        transfer.status = 'waiting';
        transfer.pumping = false;
        transfer.completionSent = false;
        this.sendRequest(transfer);
      }
    }
    this.render();
  }

  private handleChannelClose(channel: RTCDataChannel): void {
    if (this.channel === channel) {
      this.detachChannel();
    }
  }

  private sendRequest(transfer: TransferState): void {
    this.sendControl({
      type: 'request',
      senderName: this.options.getLocalName().trim() || 'Participante',
      metadata: transfer.metadata,
    });
  }

  private async handleWireMessage(data: unknown): Promise<void> {
    if (typeof data === 'string') {
      await this.handleControlMessage(parseControlMessage(data));
      return;
    }
    if (data instanceof ArrayBuffer) {
      await this.handleBinaryFrame(data);
      return;
    }
    if (data instanceof Blob) {
      await this.handleBinaryFrame(await data.arrayBuffer());
      return;
    }
    throw new Error('Formato de mensagem de transferência não suportado');
  }

  private async handleControlMessage(message: ControlMessage): Promise<void> {
    switch (message.type) {
      case 'request':
        await this.handleIncomingRequest(message);
        return;
      case 'accept':
        this.handleAccepted(message);
        return;
      case 'reject':
        await this.handleRejected(message.transferId);
        return;
      case 'ack':
        this.handleAcknowledgement(message.transferId, message.nextChunkIndex);
        return;
      case 'complete':
      case 'retry-complete':
        await this.verifyIncoming(message.transferId);
        return;
      case 'verified':
        await this.handleVerified(message.transferId, message.sha256);
        return;
      case 'retry':
        await this.resendChunks(message.transferId, message.indexes);
        return;
      case 'cancel':
        await this.handleRemoteCancel(message.transferId);
        return;
      case 'error':
        await this.failTransfer(message.transferId, message.message, false);
        return;
    }
  }

  private async handleIncomingRequest(
    message: Extract<ControlMessage, { type: 'request' }>,
  ): Promise<void> {
    const existing = this.transfers.get(message.metadata.transferId);
    if (existing !== undefined) {
      if (existing.direction !== 'received') {
        this.sendControl({
          type: 'error',
          transferId: message.metadata.transferId,
          message: 'Identificador de transferência duplicado',
        });
        return;
      }
      existing.peerName = message.senderName;
      if (existing.status === 'completed') {
        this.sendControl({
          type: 'verified',
          transferId: existing.metadata.transferId,
          sha256: existing.metadata.sha256,
        });
      } else if (existing.status === 'receiving' || existing.status === 'paused') {
        await this.prepareAndAccept(existing);
      } else if (existing.status === 'failed' || existing.status === 'rejected') {
        existing.status = 'waiting';
        delete existing.error;
        existing.auditWritten = false;
        await this.settingsReady;
        if (this.settings.autoReceive) await this.prepareAndAccept(existing);
      }
      this.render();
      return;
    }

    this.transfers.set(message.metadata.transferId, {
      metadata: message.metadata,
      direction: 'received',
      peerName: message.senderName.trim() || this.peerName,
      status: 'waiting',
      transferredBytes: 0,
      nextChunkIndex: 0,
      acknowledgedChunkIndex: 0,
      startedAt: new Date().toISOString(),
      pumping: false,
      completionSent: false,
      auditWritten: false,
    });
    this.selectedTab = 'received';
    this.options.onIncoming?.();
    this.options.notify(`Recebendo ${message.metadata.name} de ${message.senderName}.`);
    await this.settingsReady;
    const incoming = this.transfers.get(message.metadata.transferId);
    if (incoming !== undefined && this.settings.autoReceive) {
      await this.prepareAndAccept(incoming);
    }
    this.render();
  }

  private async acceptIncoming(transferId: string): Promise<void> {
    const transfer = this.transfers.get(transferId);
    if (
      transfer === undefined ||
      transfer.direction !== 'received' ||
      transfer.status !== 'waiting'
    ) {
      return;
    }
    await this.prepareAndAccept(transfer);
  }

  private async prepareAndAccept(transfer: TransferState): Promise<void> {
    try {
      const prepared = await this.options.api.prepareReceive(transfer.metadata);
      if (!prepared.accepted) {
        await this.rejectIncoming(transfer.metadata.transferId);
        return;
      }
      const nextChunkIndex = prepared.nextChunkIndex ?? 0;
      transfer.status = 'receiving';
      transfer.targetName = prepared.targetName ?? transfer.metadata.name;
      transfer.acknowledgedChunkIndex = nextChunkIndex;
      transfer.transferredBytes = bytesThroughChunk(transfer.metadata, nextChunkIndex);
      this.sendControl({
        type: 'accept',
        transferId: transfer.metadata.transferId,
        nextChunkIndex,
        targetName: transfer.targetName,
      });
      this.render();
    } catch (error) {
      if (!this.isChannelOpen()) {
        transfer.status = 'paused';
        return;
      }
      await this.failTransfer(
        transfer.metadata.transferId,
        toErrorMessage(error, 'Não foi possível preparar o destino do arquivo.'),
        true,
      );
    }
  }

  private handleAccepted(message: Extract<ControlMessage, { type: 'accept' }>): void {
    const transfer = this.transfers.get(message.transferId);
    if (transfer === undefined || transfer.direction !== 'sent') {
      return;
    }
    if (message.nextChunkIndex < 0 || message.nextChunkIndex > transfer.metadata.totalChunks) {
      void this.failTransfer(message.transferId, 'Ponto de retomada inválido', true);
      return;
    }
    transfer.status = 'sending';
    transfer.targetName = message.targetName;
    transfer.nextChunkIndex = message.nextChunkIndex;
    transfer.acknowledgedChunkIndex = message.nextChunkIndex;
    transfer.transferredBytes = bytesThroughChunk(transfer.metadata, message.nextChunkIndex);
    transfer.completionSent = false;
    this.render();
    void this.pumpOutgoing(transfer);
  }

  private async pumpOutgoing(transfer: TransferState): Promise<void> {
    if (transfer.pumping || transfer.status !== 'sending') {
      return;
    }
    transfer.pumping = true;
    try {
      while (
        transfer.status === 'sending' &&
        this.isChannelOpen() &&
        transfer.nextChunkIndex < transfer.metadata.totalChunks &&
        transfer.nextChunkIndex < transfer.acknowledgedChunkIndex + MAX_IN_FLIGHT_CHUNKS
      ) {
        const chunk = await this.options.api.readChunk(
          transfer.metadata.transferId,
          transfer.nextChunkIndex,
        );
        await this.waitForBuffer();
        this.requireOpenChannel().send(
          encodeFileTransferFrame(
            {
              transferId: chunk.transferId,
              index: chunk.index,
              sha256: chunk.sha256,
            },
            chunk.bytes,
          ),
        );
        transfer.nextChunkIndex += 1;
      }
      if (transfer.metadata.totalChunks === 0 && !transfer.completionSent && this.isChannelOpen()) {
        void this.completeOutgoing(transfer);
      }
    } catch (error) {
      if (!this.isChannelOpen()) {
        transfer.status = 'paused';
        return;
      }
      await this.failTransfer(
        transfer.metadata.transferId,
        toErrorMessage(error, 'Falha de leitura ou envio do arquivo.'),
        true,
      );
    } finally {
      transfer.pumping = false;
      this.render();
    }
  }

  private async handleBinaryFrame(data: ArrayBuffer): Promise<void> {
    const frame = decodeFileTransferFrame(data);
    const transfer = this.transfers.get(frame.header.transferId);
    if (
      transfer === undefined ||
      transfer.direction !== 'received' ||
      (transfer.status !== 'receiving' && transfer.status !== 'paused')
    ) {
      throw new Error('Bloco recebido sem transferência aceita');
    }
    transfer.status = 'receiving';
    try {
      const nextChunkIndex = await this.options.api.writeChunk({
        transferId: frame.header.transferId,
        index: frame.header.index,
        sha256: frame.header.sha256,
        bytes: frame.bytes,
      });
      transfer.acknowledgedChunkIndex = nextChunkIndex;
      transfer.transferredBytes = bytesThroughChunk(transfer.metadata, nextChunkIndex);
      this.sendControl({
        type: 'ack',
        transferId: frame.header.transferId,
        nextChunkIndex,
      });
      this.render();
    } catch (error) {
      const message = toErrorMessage(error, 'Falha ao gravar o arquivo recebido.');
      if (message.toLocaleLowerCase('pt-BR').includes('integridade')) {
        this.sendControl({
          type: 'retry',
          transferId: frame.header.transferId,
          indexes: [frame.header.index],
        });
        this.options.notify(
          `O bloco ${frame.header.index + 1} falhou na verificação e será reenviado.`,
        );
        return;
      }
      this.sendControl({
        type: 'error',
        transferId: frame.header.transferId,
        message,
      });
      await this.failTransfer(frame.header.transferId, message, false);
    }
  }

  private handleAcknowledgement(transferId: string, nextChunkIndex: number): void {
    const transfer = this.transfers.get(transferId);
    if (
      transfer === undefined ||
      transfer.direction !== 'sent' ||
      transfer.status !== 'sending' ||
      !Number.isInteger(nextChunkIndex) ||
      nextChunkIndex < transfer.acknowledgedChunkIndex ||
      nextChunkIndex > transfer.metadata.totalChunks
    ) {
      return;
    }
    transfer.acknowledgedChunkIndex = nextChunkIndex;
    transfer.transferredBytes = bytesThroughChunk(transfer.metadata, nextChunkIndex);
    if (nextChunkIndex === transfer.metadata.totalChunks) {
      if (!transfer.completionSent) {
        void this.completeOutgoing(transfer);
      }
    } else {
      void this.pumpOutgoing(transfer);
    }
    this.render();
  }

  private async completeOutgoing(transfer: TransferState): Promise<void> {
    transfer.completionSent = true;
    try {
      if (!(await this.options.api.verifySource(transfer.metadata.transferId))) {
        await this.failTransfer(
          transfer.metadata.transferId,
          'O arquivo de origem foi alterado durante a transferência.',
          true,
        );
        return;
      }
      if (this.isChannelOpen()) {
        this.sendControl({ type: 'complete', transferId: transfer.metadata.transferId });
      }
    } catch (error) {
      if (!this.isChannelOpen()) {
        transfer.status = 'paused';
        return;
      }
      await this.failTransfer(
        transfer.metadata.transferId,
        toErrorMessage(error, 'Não foi possível verificar o arquivo de origem.'),
        true,
      );
    }
  }

  private async verifyIncoming(transferId: string): Promise<void> {
    const transfer = this.transfers.get(transferId);
    if (transfer === undefined || transfer.direction !== 'received') {
      return;
    }
    try {
      const verification = await this.options.api.completeReceive(transferId);
      if (!verification.valid) {
        this.sendControl({
          type: 'retry',
          transferId,
          indexes: verification.badChunkIndexes,
        });
        return;
      }
      transfer.status = 'completed';
      transfer.transferredBytes = transfer.metadata.size;
      if (verification.destinationPath !== undefined) {
        transfer.destinationPath = verification.destinationPath;
      }
      this.sendControl({ type: 'verified', transferId, sha256: verification.actualSha256 });
      await this.writeAudit(transfer, 'completed');
      this.options.notify(
        `Arquivo recebido com sucesso: ${transfer.targetName ?? transfer.metadata.name}`,
      );
      this.render();
    } catch (error) {
      if (!this.isChannelOpen()) {
        transfer.status = 'paused';
        return;
      }
      await this.failTransfer(
        transferId,
        toErrorMessage(error, 'Não foi possível verificar o arquivo recebido.'),
        true,
      );
    }
  }

  private async resendChunks(transferId: string, indexes: readonly number[]): Promise<void> {
    const transfer = this.transfers.get(transferId);
    if (transfer === undefined || transfer.direction !== 'sent') {
      return;
    }
    try {
      for (const index of indexes) {
        if (!Number.isInteger(index) || index < 0 || index >= transfer.metadata.totalChunks) {
          throw new Error('Solicitação de reenvio inválida');
        }
        const chunk = await this.options.api.readChunk(transferId, index);
        await this.waitForBuffer();
        this.requireOpenChannel().send(
          encodeFileTransferFrame({ transferId, index, sha256: chunk.sha256 }, chunk.bytes),
        );
      }
      this.sendControl({ type: 'retry-complete', transferId });
    } catch (error) {
      if (!this.isChannelOpen()) {
        transfer.status = 'paused';
        return;
      }
      await this.failTransfer(
        transferId,
        toErrorMessage(error, 'Não foi possível reenviar os blocos necessários.'),
        true,
      );
    }
  }

  private async handleVerified(transferId: string, sha256: string): Promise<void> {
    const transfer = this.transfers.get(transferId);
    if (transfer === undefined || transfer.direction !== 'sent') {
      return;
    }
    if (sha256 !== transfer.metadata.sha256) {
      await this.failTransfer(transferId, 'O hash SHA-256 final não corresponde à origem', true);
      return;
    }
    transfer.status = 'completed';
    transfer.transferredBytes = transfer.metadata.size;
    await this.options.api.releaseSource(transferId);
    await this.writeAudit(transfer, 'completed');
    this.render();
  }

  private async rejectIncoming(transferId: string): Promise<void> {
    const transfer = this.transfers.get(transferId);
    if (transfer === undefined || transfer.direction !== 'received') {
      return;
    }
    transfer.status = 'rejected';
    this.sendControl({ type: 'reject', transferId });
    await this.writeAudit(transfer, 'rejected');
    this.render();
  }

  private async handleRejected(transferId: string): Promise<void> {
    const transfer = this.transfers.get(transferId);
    if (transfer === undefined || transfer.direction !== 'sent') {
      return;
    }
    transfer.status = 'rejected';
    await this.writeAudit(transfer, 'rejected');
    this.render();
  }

  private async cancelTransfer(transferId: string): Promise<void> {
    const transfer = this.transfers.get(transferId);
    if (transfer === undefined || isTerminal(transfer.status)) {
      return;
    }
    this.sendControl({ type: 'cancel', transferId });
    transfer.status = 'cancelled';
    if (transfer.direction === 'sent') {
      await this.options.api.releaseSource(transferId);
    } else {
      await this.options.api.cancelReceive(transferId);
    }
    await this.writeAudit(transfer, 'cancelled');
    this.render();
  }

  private async handleRemoteCancel(transferId: string): Promise<void> {
    const transfer = this.transfers.get(transferId);
    if (transfer === undefined || isTerminal(transfer.status)) {
      return;
    }
    transfer.status = 'cancelled';
    if (transfer.direction === 'sent') {
      await this.options.api.releaseSource(transferId);
    } else {
      await this.options.api.cancelReceive(transferId);
    }
    await this.writeAudit(transfer, 'cancelled');
    this.render();
  }

  private async failTransfer(
    transferId: string,
    message: string,
    notifyPeer: boolean,
  ): Promise<void> {
    const transfer = this.transfers.get(transferId);
    if (transfer === undefined || isTerminal(transfer.status)) {
      return;
    }
    transfer.status = 'failed';
    transfer.error = message;
    if (notifyPeer) {
      this.sendControl({ type: 'error', transferId, message });
    }
    if (transfer.direction === 'sent') {
      transfer.pumping = false;
    }
    await this.writeAudit(transfer, 'failed', message);
    this.options.notify(message);
    this.render();
  }

  private async writeAudit(
    transfer: TransferState,
    result: FileTransferAuditPayload['result'],
    error?: string,
  ): Promise<void> {
    if (transfer.auditWritten) {
      return;
    }
    transfer.auditWritten = true;
    const finishedAt = new Date().toISOString();
    const elapsedSeconds = Math.max(
      0.001,
      (Date.parse(finishedAt) - Date.parse(transfer.startedAt)) / 1000,
    );
    await this.options.api
      .appendAudit({
        transferId: transfer.metadata.transferId,
        direction: transfer.direction,
        origin: transfer.direction === 'sent' ? this.options.getLocalName() : transfer.peerName,
        destination:
          transfer.direction === 'sent' ? transfer.peerName : this.options.getLocalName(),
        peerName: transfer.peerName,
        fileName: transfer.targetName ?? transfer.metadata.name,
        size: transfer.metadata.size,
        startedAt: transfer.startedAt,
        finishedAt,
        averageBytesPerSecond: transfer.transferredBytes / elapsedSeconds,
        sha256: transfer.metadata.sha256,
        result,
        ...(transfer.destinationPath === undefined
          ? {}
          : { destinationPath: transfer.destinationPath }),
        ...(error === undefined ? {} : { error }),
      })
      .catch(() => undefined);
  }

  private async clearTransfers(): Promise<void> {
    const operations: Promise<unknown>[] = [];
    for (const transfer of this.transfers.values()) {
      if (transfer.direction === 'sent') {
        operations.push(this.options.api.releaseSource(transfer.metadata.transferId));
      } else if (!isTerminal(transfer.status)) {
        operations.push(this.options.api.cancelReceive(transfer.metadata.transferId));
      }
    }
    this.transfers.clear();
    await Promise.allSettled(operations);
    this.render();
  }

  private sendControl(message: ControlMessage): void {
    if (this.isChannelOpen()) {
      this.requireOpenChannel().send(JSON.stringify(message));
    }
  }

  private async waitForBuffer(): Promise<void> {
    while (this.requireOpenChannel().bufferedAmount > MAX_BUFFERED_BYTES) {
      await delay(15);
    }
  }

  private isChannelOpen(): boolean {
    return this.channel?.readyState === 'open';
  }

  private requireOpenChannel(): RTCDataChannel {
    if (!this.isChannelOpen() || this.channel === undefined) {
      throw new Error('Conexão de transferência interrompida');
    }
    return this.channel;
  }

  private retryTransfer(transferId: string): void {
    const transfer = this.transfers.get(transferId);
    if (
      transfer === undefined ||
      transfer.direction !== 'sent' ||
      (transfer.status !== 'failed' && transfer.status !== 'rejected') ||
      !this.isChannelOpen()
    ) {
      return;
    }
    transfer.status = 'waiting';
    transfer.startedAt = new Date().toISOString();
    delete transfer.error;
    transfer.transferredBytes = 0;
    transfer.nextChunkIndex = 0;
    transfer.acknowledgedChunkIndex = 0;
    transfer.pumping = false;
    transfer.completionSent = false;
    transfer.auditWritten = false;
    this.sendRequest(transfer);
    this.render();
  }

  private async loadSettings(): Promise<void> {
    try {
      this.settings = await this.options.api.getSettings();
      this.renderSettings();
    } catch (error) {
      this.options.notify(
        toErrorMessage(error, 'Não foi possível carregar as preferências de arquivos.'),
      );
    }
  }

  private async loadHistory(): Promise<void> {
    try {
      this.history = await this.options.api.listHistory();
      this.render();
    } catch (error) {
      this.options.notify(toErrorMessage(error, 'Não foi possível carregar o histórico.'));
    }
  }

  private renderSettings(): void {
    this.options.elements.autoReceive.checked = this.settings.autoReceive;
    const modeLabel = this.options.elements.autoReceive
      .closest('.file-transfer-switch')
      ?.querySelector('em');
    if (modeLabel !== null && modeLabel !== undefined) {
      modeLabel.textContent = this.settings.autoReceive ? 'Sim' : 'Perguntar antes';
    }
    this.options.elements.destination.textContent =
      this.settings.destinationDirectory || 'Downloads/Professor Connect/Recebidos';
    this.options.elements.destination.title = this.settings.destinationDirectory;
  }

  private render(): void {
    this.options.elements.button.disabled = !this.isChannelOpen();
    this.options.elements.panel.hidden = this.sessionId === undefined && this.transfers.size === 0;
    for (const button of this.options.elements.panel.querySelectorAll<HTMLButtonElement>(
      '[data-transfer-tab]',
    )) {
      button.setAttribute('aria-selected', String(button.dataset.transferTab === this.selectedTab));
    }
    const items =
      this.selectedTab === 'history'
        ? this.history.map((entry) => createHistoryItem(entry))
        : [...this.transfers.values()]
            .filter((transfer) => transfer.direction === this.selectedTab)
            .map((transfer) => createTransferItem(transfer));
    if (items.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'file-transfer-empty';
      empty.textContent =
        this.selectedTab === 'history'
          ? 'O histórico de transferências aparecerá aqui.'
          : `Nenhum arquivo ${this.selectedTab === 'sent' ? 'enviado' : 'recebido'} nesta sessão.`;
      this.options.elements.list.replaceChildren(empty);
    } else {
      this.options.elements.list.replaceChildren(...items);
    }
  }
}

function createTransferItem(transfer: TransferState): HTMLLIElement {
  const item = document.createElement('li');
  const heading = document.createElement('div');
  const name = document.createElement('strong');
  const status = document.createElement('span');
  const progress = document.createElement('progress');
  const details = document.createElement('small');
  const actions = document.createElement('div');
  const elapsedSeconds = Math.max(0.001, (Date.now() - Date.parse(transfer.startedAt)) / 1000);
  const speed = transfer.transferredBytes / elapsedSeconds;
  const remaining = Math.max(0, transfer.metadata.size - transfer.transferredBytes);
  const eta = speed > 0 ? remaining / speed : undefined;
  const percentage =
    transfer.metadata.size === 0
      ? 100
      : Math.min(100, Math.round((transfer.transferredBytes / transfer.metadata.size) * 100));

  item.className = 'file-transfer-item';
  heading.className = 'file-transfer-heading';
  name.textContent = transfer.targetName ?? transfer.metadata.name;
  status.textContent = statusLabel(transfer.status, transfer.direction);
  status.dataset.status = transfer.status;
  heading.append(name, status);
  progress.max = Math.max(1, transfer.metadata.size);
  progress.value = transfer.metadata.size === 0 ? 1 : transfer.transferredBytes;
  details.textContent = `${percentage}% · ${formatBytes(transfer.transferredBytes)} / ${formatBytes(
    transfer.metadata.size,
  )} · ${formatSpeed(speed)} · ${formatEta(eta)} restantes · ${
    transfer.direction === 'sent' ? 'para' : 'de'
  } ${transfer.peerName}`;
  item.append(heading, progress, details);

  if (transfer.error !== undefined) {
    const error = document.createElement('small');
    error.className = 'file-transfer-error';
    error.textContent = transfer.error;
    item.append(error);
  }

  if (transfer.direction === 'received' && transfer.status === 'waiting') {
    actions.append(
      createActionButton('Aceitar', 'accept', transfer.metadata.transferId),
      createActionButton('Recusar', 'reject', transfer.metadata.transferId),
    );
  } else if (!isTerminal(transfer.status)) {
    actions.append(createActionButton('Cancelar', 'cancel', transfer.metadata.transferId));
  } else if (
    transfer.direction === 'sent' &&
    (transfer.status === 'failed' || transfer.status === 'rejected')
  ) {
    actions.append(createActionButton('Reenviar', 'retry', transfer.metadata.transferId));
  } else if (transfer.status === 'completed' && transfer.direction === 'received') {
    actions.append(
      createActionButton('Abrir arquivo', 'open', transfer.metadata.transferId),
      createActionButton('Abrir pasta', 'folder', transfer.metadata.transferId),
      createActionButton('Fechar', 'close', transfer.metadata.transferId),
    );
  } else if (isTerminal(transfer.status)) {
    actions.append(createActionButton('Fechar', 'close', transfer.metadata.transferId));
  }
  if (actions.childElementCount > 0) {
    actions.className = 'file-transfer-actions';
    item.append(actions);
  }
  return item;
}

function createHistoryItem(entry: FileTransferAuditPayload): HTMLLIElement {
  const item = document.createElement('li');
  const heading = document.createElement('div');
  const name = document.createElement('strong');
  const status = document.createElement('span');
  const details = document.createElement('small');
  item.className = 'file-transfer-item file-transfer-history-item';
  heading.className = 'file-transfer-heading';
  name.textContent = entry.fileName;
  status.textContent = historyStatusLabel(entry.result);
  status.dataset.status = entry.result === 'completed' ? 'completed' : 'failed';
  details.textContent = `${entry.direction === 'sent' ? 'Enviado para' : 'Recebido de'} ${
    entry.peerName
  } · ${formatBytes(entry.size)} · ${new Date(entry.finishedAt).toLocaleString('pt-BR')}`;
  heading.append(name, status);
  item.append(heading, details);
  if (entry.destinationPath !== undefined && entry.result === 'completed') {
    const actions = document.createElement('div');
    const open = createActionButton('Abrir arquivo', 'open', entry.transferId);
    open.dataset.filePath = entry.destinationPath;
    actions.className = 'file-transfer-actions';
    actions.append(open, createActionButton('Abrir pasta', 'folder', entry.transferId));
    item.append(actions);
  }
  return item;
}

function createActionButton(label: string, action: string, transferId: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.dataset.action = action;
  button.dataset.transferId = transferId;
  return button;
}

export function encodeFileTransferFrame(header: BinaryFrameHeader, bytes: Uint8Array): ArrayBuffer {
  const encodedHeader = new TextEncoder().encode(JSON.stringify(header));
  if (encodedHeader.byteLength > FRAME_HEADER_LIMIT) {
    throw new Error('Cabeçalho do bloco excede o limite permitido');
  }
  const frame = new Uint8Array(4 + encodedHeader.byteLength + bytes.byteLength);
  new DataView(frame.buffer).setUint32(0, encodedHeader.byteLength, true);
  frame.set(encodedHeader, 4);
  frame.set(bytes, 4 + encodedHeader.byteLength);
  return frame.buffer;
}

export function decodeFileTransferFrame(data: ArrayBuffer): {
  readonly header: BinaryFrameHeader;
  readonly bytes: Uint8Array;
} {
  if (data.byteLength < 5) {
    throw new Error('Bloco de arquivo truncado');
  }
  const headerLength = new DataView(data).getUint32(0, true);
  if (
    headerLength === 0 ||
    headerLength > FRAME_HEADER_LIMIT ||
    4 + headerLength >= data.byteLength
  ) {
    throw new Error('Cabeçalho de bloco inválido');
  }
  const parsed: unknown = JSON.parse(
    new TextDecoder().decode(new Uint8Array(data, 4, headerLength)),
  );
  const record = requireRecord(parsed);
  if (
    typeof record.transferId !== 'string' ||
    typeof record.index !== 'number' ||
    !Number.isInteger(record.index) ||
    record.index < 0 ||
    typeof record.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(record.sha256)
  ) {
    throw new Error('Cabeçalho de bloco inválido');
  }
  return {
    header: {
      transferId: record.transferId,
      index: record.index,
      sha256: record.sha256,
    },
    bytes: new Uint8Array(data.slice(4 + headerLength)),
  };
}

function parseControlMessage(data: string): ControlMessage {
  if (data.length > 64 * 1024) {
    throw new Error('Mensagem de controle excede o limite permitido');
  }
  const parsed: unknown = JSON.parse(data);
  const record = requireRecord(parsed);
  if (record.type === 'request') {
    const metadata = requireMetadata(record.metadata);
    if (typeof record.senderName !== 'string') {
      throw new Error('Solicitação de arquivo inválida');
    }
    return { type: 'request', senderName: record.senderName, metadata };
  }
  const transferId = requireTransferId(record.transferId);
  switch (record.type) {
    case 'accept':
      if (
        typeof record.nextChunkIndex !== 'number' ||
        !Number.isInteger(record.nextChunkIndex) ||
        typeof record.targetName !== 'string'
      ) {
        throw new Error('Aceite de arquivo inválido');
      }
      return {
        type: 'accept',
        transferId,
        nextChunkIndex: record.nextChunkIndex,
        targetName: record.targetName,
      };
    case 'reject':
    case 'complete':
    case 'retry-complete':
    case 'cancel':
      return { type: record.type, transferId };
    case 'ack':
      if (typeof record.nextChunkIndex !== 'number' || !Number.isInteger(record.nextChunkIndex)) {
        throw new Error('Confirmação de bloco inválida');
      }
      return { type: 'ack', transferId, nextChunkIndex: record.nextChunkIndex };
    case 'verified':
      if (typeof record.sha256 !== 'string') {
        throw new Error('Verificação de arquivo inválida');
      }
      return { type: 'verified', transferId, sha256: record.sha256 };
    case 'retry':
      if (
        !Array.isArray(record.indexes) ||
        !record.indexes.every((index) => typeof index === 'number' && Number.isInteger(index))
      ) {
        throw new Error('Solicitação de reenvio inválida');
      }
      return { type: 'retry', transferId, indexes: record.indexes as number[] };
    case 'error':
      if (typeof record.message !== 'string') {
        throw new Error('Mensagem de falha inválida');
      }
      return { type: 'error', transferId, message: record.message };
    default:
      throw new Error('Mensagem de controle desconhecida');
  }
}

function requireMetadata(value: unknown): FileTransferMetadata {
  const record = requireRecord(value);
  if (
    typeof record.name !== 'string' ||
    typeof record.size !== 'number' ||
    !Number.isSafeInteger(record.size) ||
    record.size < 0 ||
    typeof record.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(record.sha256) ||
    record.chunkSize !== 64 * 1024 ||
    typeof record.totalChunks !== 'number' ||
    record.totalChunks !== Math.ceil(record.size / record.chunkSize)
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

function requireTransferId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{8,128}$/u.test(value)) {
    throw new Error('Identificador de transferência inválido');
  }
  return value;
}

function requireRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Mensagem de transferência inválida');
  }
  return value as Readonly<Record<string, unknown>>;
}

function bytesThroughChunk(metadata: FileTransferMetadata, nextChunkIndex: number): number {
  return Math.min(metadata.size, nextChunkIndex * metadata.chunkSize);
}

function isTerminal(status: FileTransferStatus): boolean {
  return (
    status === 'completed' || status === 'cancelled' || status === 'failed' || status === 'rejected'
  );
}

function statusLabel(status: FileTransferStatus, direction: TransferState['direction']): string {
  const labels: Record<FileTransferStatus, string> = {
    waiting: direction === 'sent' ? 'Preparando envio' : 'Aguardando confirmação',
    sending: 'Enviando',
    receiving: 'Recebendo',
    paused: 'Aguardando conexão',
    completed: 'Concluído',
    cancelled: 'Cancelado',
    failed: 'Falhou',
    rejected: 'Recusado',
  };
  return labels[status];
}

function historyStatusLabel(result: FileTransferAuditPayload['result']): string {
  const labels: Record<FileTransferAuditPayload['result'], string> = {
    completed: 'Concluído',
    cancelled: 'Cancelado',
    failed: 'Falhou',
    rejected: 'Recusado',
  };
  return labels[result];
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  const units = ['KB', 'MB', 'GB', 'TB'];
  let normalized = value / 1024;
  let unitIndex = 0;
  while (normalized >= 1024 && unitIndex < units.length - 1) {
    normalized /= 1024;
    unitIndex += 1;
  }
  return `${normalized.toFixed(normalized >= 100 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatSpeed(bytesPerSecond: number): string {
  return bytesPerSecond > 0 ? `${formatBytes(bytesPerSecond)}/s` : '0 B/s';
}

function formatEta(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) {
    return '--';
  }
  if (seconds < 60) {
    return `${Math.ceil(seconds)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.ceil(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
