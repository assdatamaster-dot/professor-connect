import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

const rootDirectory = path.resolve(import.meta.dirname, '..');
const electronExecutable = path.join(
  rootDirectory,
  'node_modules',
  'electron',
  'dist',
  'electron.exe',
);
const durationSeconds = Number.parseInt(process.argv[2] ?? '120', 10);
const outputPath = path.resolve(
  rootDirectory,
  process.argv[3] ?? 'auditorias/screen-stream-audit.json',
);
const auditId = `${Date.now()}-${process.pid}`;
const teacherPort = 19_220;
const studentPort = 19_221;
const processes = [];
const clients = [];
const startedAt = new Date().toISOString();

if (!Number.isFinite(durationSeconds) || durationSeconds < 10) {
  throw new Error('A duração deve ser de pelo menos 10 segundos.');
}

async function main() {
  try {
    const teacher = await launchElectron('teacher', teacherPort);
    const teacherClient = await connectToRenderer(teacherPort, 'presence.html');
    clients.push(teacherClient);
    await installAuditHooks(teacherClient);
    await waitFor(
      teacherClient,
      `document.readyState === 'complete' &&
      document.activeElement?.id === 'professor-name'`,
      'renderer do professor inicializado',
    );
    await evaluate(
      teacherClient,
      `(() => {
      const input = document.getElementById('professor-name');
      input.value = ${JSON.stringify(`Codex Audit ${auditId}`)};
      document.getElementById('login-form').requestSubmit();
    })()`,
    );
    await waitFor(
      teacherClient,
      `document.getElementById('server-status')?.textContent === 'Conectado' &&
      document.getElementById('online-view')?.hidden === false`,
      'professor conectado',
    );

    const student = await launchElectron('student', studentPort);
    const studentClient = await connectToRenderer(studentPort, 'index.html');
    clients.push(studentClient);
    await installAuditHooks(studentClient);
    await waitFor(
      studentClient,
      `document.readyState === 'complete' &&
      typeof window.professorConnectSession?.getOnlineTeachers === 'function'`,
      'renderer do aluno inicializado',
    );
    await waitFor(
      studentClient,
      `document.querySelectorAll('#teacher-select option[value]:not([value=""])').length > 0`,
      'professor visível para o aluno',
    );
    await evaluate(
      studentClient,
      `(async () => {
      const select = document.getElementById('teacher-select');
      const option = [...select.options].find((candidate) =>
        candidate.textContent.includes(${JSON.stringify(`Codex Audit ${auditId}`)})
      );
      if (!option) throw new Error('Professor da auditoria não encontrado');
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      let lastError;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        try {
          await window.professorConnectSession.requestSession(option.value);
          return;
        } catch (error) {
          lastError = error;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
      throw lastError;
    })()`,
      true,
    );
    await waitFor(
      teacherClient,
      `document.getElementById('session-request-dialog')?.open === true`,
      'solicitação recebida',
    );
    await evaluate(teacherClient, `document.getElementById('accept-session').click()`);
    await waitFor(
      studentClient,
      `document.getElementById('media-section')?.hidden === false`,
      'sessão WebRTC do aluno',
      45_000,
    );
    await waitFor(
      teacherClient,
      `document.getElementById('active-attendance')?.hidden === false`,
      'sessão WebRTC do professor',
      45_000,
    );

    await waitFor(
      studentClient,
      `document.getElementById('share-screen')?.disabled === false &&
      globalThis.__screenAudit.peerConnections.some(
        (connection) => connection.signalingState === 'stable'
      )`,
      'compartilhamento de tela habilitado',
      45_000,
    );
    await evaluate(studentClient, `document.getElementById('share-screen').click()`);
    await waitFor(
      studentClient,
      `document.getElementById('screen-status')?.textContent.includes('Compartilhando')`,
      'captura de tela iniciada',
      45_000,
    );
    await waitFor(
      teacherClient,
      `document.getElementById('teacher-screen-video')?.srcObject instanceof MediaStream &&
      document.getElementById('teacher-screen-video').srcObject.getVideoTracks().length > 0`,
      'track de tela recebida',
      45_000,
    );
    await installAuditHooks(teacherClient);
    await startRenderedFrameCounter(teacherClient);

    await evaluate(teacherClient, `document.getElementById('request-remote-control').click()`);
    await waitFor(
      studentClient,
      `document.getElementById('remote-control-dialog')?.open === true`,
      'autorização de controle remoto',
    );
    await evaluate(studentClient, `document.getElementById('approve-remote-control').click()`);
    await waitFor(
      teacherClient,
      `document.getElementById('remote-control-status')?.textContent.includes('Ativo')`,
      'controle remoto ativo',
    );

    await startVisualWorkload(studentClient);
    await startRemoteInputWorkload(teacherClient);
    await teacherClient.send('Page.bringToFront');

    const samples = [];
    const sampleStartedAt = Date.now();
    while (Date.now() - sampleStartedAt < durationSeconds * 1_000) {
      const timestamp = new Date().toISOString();
      const [studentMetrics, teacherMetrics, studentProcesses, teacherProcesses] =
        await Promise.all([
          collectRendererMetrics(studentClient),
          collectRendererMetrics(teacherClient),
          collectProcessMetrics(studentPort),
          collectProcessMetrics(teacherPort),
        ]);
      samples.push({
        timestamp,
        student: studentMetrics,
        teacher: teacherMetrics,
        processes: {
          student: studentProcesses,
          teacher: teacherProcesses,
        },
      });
      process.stdout.write(
        `[audit] ${timestamp} ${samples.length}/${Math.ceil(durationSeconds / 2)}\n`,
      );
      await delay(2_000);
    }

    const result = {
      auditId,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationSeconds,
      environment: {
        platform: process.platform,
        node: process.version,
      },
      summary: summarize(samples),
      samples,
    };
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    process.stdout.write(`[audit] relatório salvo em ${outputPath}\n`);

    await evaluate(teacherClient, `document.getElementById('end-session').click()`).catch(
      () => undefined,
    );
  } finally {
    for (const client of clients) {
      client.close();
    }
    await Promise.all(
      processes.map(async (child) => {
        if (child.exitCode !== null) {
          return;
        }
        const exited = new Promise((resolve) => child.once('exit', resolve));
        child.kill();
        await Promise.race([exited, delay(5_000)]);
      }),
    );
    await Promise.all(
      ['teacher', 'student'].map((role) => {
        const profile = path.join(tmpdir(), `professor-connect-screen-audit-${auditId}-${role}`);
        return removeProfile(profile);
      }),
    );
  }
}

async function launchElectron(role, port) {
  const profile = path.join(tmpdir(), `professor-connect-screen-audit-${auditId}-${role}`);
  const appDirectory = path.join(rootDirectory, 'apps', `${role}-electron`);
  await mkdir(profile, { recursive: true });
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    electronExecutable,
    [
      '.',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--disable-breakpad',
    ],
    {
      cwd: appDirectory,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  processes.push(child);
  child.stdout.on('data', (chunk) => {
    const output = chunk.toString();
    if (!output.includes('"event":"MouseMove"')) {
      process.stdout.write(`[${role}] ${output}`);
    }
  });
  child.stderr.on('data', (chunk) => process.stderr.write(`[${role}] ${chunk}`));
  child.once('exit', (code) => {
    if (code !== null && code !== 0) {
      process.stderr.write(`[${role}] Electron encerrou com código ${code}\n`);
    }
  });
  await waitForEndpoint(`http://127.0.0.1:${port}/json/version`);
  return child;
}

async function connectToRenderer(port, pageSuffix) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) =>
      response.json(),
    );
    const target = targets.find(
      (candidate) =>
        candidate.type === 'page' &&
        candidate.url.includes(pageSuffix) &&
        typeof candidate.webSocketDebuggerUrl === 'string',
    );
    if (target !== undefined) {
      const client = await CdpClient.connect(target.webSocketDebuggerUrl);
      await client.send('Runtime.enable');
      await client.send('Page.enable');
      return client;
    }
    await delay(250);
  }
  throw new Error(`Renderer ${pageSuffix} não apareceu na porta ${port}.`);
}

async function installAuditHooks(client) {
  await evaluate(
    client,
    `(() => {
      if (globalThis.__screenAudit) return;
      const NativePeerConnection = globalThis.RTCPeerConnection;
      const state = {
        peerConnections: [],
        sourceStreams: [],
        drawImageCalls: 0,
        rendered: {
          frames: 0,
          droppedByCallback: 0,
          maximumGapMs: 0,
          delayFromCaptureMs: [],
          delayFromReceiveMs: [],
          decodeMs: [],
        },
      };
      globalThis.RTCPeerConnection = new Proxy(NativePeerConnection, {
        construct(target, argumentsList) {
          const connection = Reflect.construct(target, argumentsList);
          state.peerConnections.push(connection);
          return connection;
        },
      });
      const mediaDescriptor = Object.getOwnPropertyDescriptor(
        HTMLMediaElement.prototype,
        'srcObject',
      );
      Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
        configurable: mediaDescriptor.configurable,
        enumerable: mediaDescriptor.enumerable,
        get: mediaDescriptor.get,
        set(value) {
          if (value instanceof MediaStream && this.id.length === 0) {
            state.sourceStreams.push(value);
          }
          return mediaDescriptor.set.call(this, value);
        },
      });
      const nativeDrawImage = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function (...args) {
        state.drawImageCalls += 1;
        return nativeDrawImage.apply(this, args);
      };
      globalThis.__screenAudit = state;
    })()`,
  );
}

async function startRenderedFrameCounter(client) {
  await evaluate(
    client,
    `(() => {
      const state = globalThis.__screenAudit.rendered;
      const video = document.getElementById('teacher-screen-video');
      let lastNow;
      let lastPresentedFrames;
      const record = (now, metadata) => {
        state.frames += 1;
        if (lastNow !== undefined) {
          state.maximumGapMs = Math.max(state.maximumGapMs, now - lastNow);
        }
        if (lastPresentedFrames !== undefined && metadata.presentedFrames > lastPresentedFrames + 1) {
          state.droppedByCallback += metadata.presentedFrames - lastPresentedFrames - 1;
        }
        if (Number.isFinite(metadata.captureTime)) {
          state.delayFromCaptureMs.push(now - metadata.captureTime);
        }
        if (Number.isFinite(metadata.receiveTime)) {
          state.delayFromReceiveMs.push(now - metadata.receiveTime);
        }
        if (Number.isFinite(metadata.processingDuration)) {
          state.decodeMs.push(metadata.processingDuration * 1_000);
        }
        lastNow = now;
        lastPresentedFrames = metadata.presentedFrames;
        video.requestVideoFrameCallback(record);
      };
      video.requestVideoFrameCallback(record);
    })()`,
  );
}

async function startVisualWorkload(client) {
  await evaluate(
    client,
    `(() => {
      const overlay = document.createElement('div');
      overlay.id = 'screen-audit-workload';
      overlay.style.cssText = [
        'position:fixed',
        'inset:0',
        'z-index:2147483647',
        'pointer-events:none',
        'display:grid',
        'place-items:center',
        'font:700 72px system-ui',
        'color:white',
        'background:#0047ab',
      ].join(';');
      document.body.append(overlay);
      let frame = 0;
      globalThis.__screenAudit.workloadTimer = setInterval(() => {
        frame += 1;
        overlay.textContent = 'SCREEN AUDIT ' + frame;
        overlay.style.background =
          'hsl(' + ((frame * 47) % 360) + ' 80% ' + (35 + (frame % 25)) + '%)';
        overlay.style.transform =
          'translate(' + ((frame % 9) - 4) + 'px,' + (((frame * 3) % 9) - 4) + 'px)';
      }, 100);
    })()`,
  );
}

async function startRemoteInputWorkload(client) {
  await evaluate(
    client,
    `(() => {
      const video = document.getElementById('teacher-screen-video');
      let frame = 0;
      globalThis.__screenAudit.remoteInput = {
        mouseMovesDispatched: 0,
        keyboardPairsDispatched: 0,
      };
      globalThis.__screenAudit.remoteInputTimer = setInterval(() => {
        const bounds = video.getBoundingClientRect();
        const x = bounds.left + bounds.width * ((frame % 100) / 99);
        const y = bounds.top + bounds.height * (((frame * 7) % 100) / 99);
        video.dispatchEvent(new MouseEvent('mousemove', {
          bubbles: true,
          clientX: x,
          clientY: y,
          buttons: 0,
        }));
        globalThis.__screenAudit.remoteInput.mouseMovesDispatched += 1;
        if (frame % 90 === 0) {
          window.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            key: 'a',
            code: 'KeyA',
          }));
          window.dispatchEvent(new KeyboardEvent('keyup', {
            bubbles: true,
            key: 'a',
            code: 'KeyA',
          }));
          globalThis.__screenAudit.remoteInput.keyboardPairsDispatched += 1;
        }
        frame += 1;
      }, 33);
    })()`,
  );
}

async function collectRendererMetrics(client) {
  return evaluate(
    client,
    `(async () => {
      const state = globalThis.__screenAudit;
      const peerReports = [];
      for (const connection of state.peerConnections) {
        const report = await connection.getStats();
        const selected = [];
        report.forEach((entry) => {
          if (
            entry.type === 'outbound-rtp' ||
            entry.type === 'remote-inbound-rtp' ||
            entry.type === 'inbound-rtp' ||
            entry.type === 'candidate-pair' ||
            entry.type === 'codec' ||
            entry.type === 'media-source'
          ) {
            selected.push({
              id: entry.id,
              type: entry.type,
              kind: entry.kind ?? entry.mediaType,
              state: entry.state,
              nominated: entry.nominated,
              selected: entry.selected,
              codecId: entry.codecId,
              mimeType: entry.mimeType,
              trackIdentifier: entry.trackIdentifier,
              frames: entry.frames,
              framesSent: entry.framesSent,
              framesEncoded: entry.framesEncoded,
              framesReceived: entry.framesReceived,
              framesDecoded: entry.framesDecoded,
              framesDropped: entry.framesDropped,
              framesPerSecond: entry.framesPerSecond,
              frameWidth: entry.frameWidth,
              frameHeight: entry.frameHeight,
              bytesSent: entry.bytesSent,
              bytesReceived: entry.bytesReceived,
              packetsSent: entry.packetsSent,
              packetsReceived: entry.packetsReceived,
              packetsLost: entry.packetsLost,
              jitter: entry.jitter,
              roundTripTime: entry.roundTripTime,
              currentRoundTripTime: entry.currentRoundTripTime,
              availableOutgoingBitrate: entry.availableOutgoingBitrate,
              availableIncomingBitrate: entry.availableIncomingBitrate,
              qualityLimitationReason: entry.qualityLimitationReason,
              qualityLimitationDurations: entry.qualityLimitationDurations,
              totalEncodeTime: entry.totalEncodeTime,
              totalDecodeTime: entry.totalDecodeTime,
              totalInterFrameDelay: entry.totalInterFrameDelay,
              totalSquaredInterFrameDelay: entry.totalSquaredInterFrameDelay,
              freezeCount: entry.freezeCount,
              totalFreezesDuration: entry.totalFreezesDuration,
              pauseCount: entry.pauseCount,
              totalPausesDuration: entry.totalPausesDuration,
              targetBitrate: entry.targetBitrate,
            });
          }
        });
        peerReports.push({
          connectionState: connection.connectionState,
          iceConnectionState: connection.iceConnectionState,
          signalingState: connection.signalingState,
          senders: connection
            .getSenders()
            .filter((sender) => sender.track?.kind === 'video')
            .map((sender) => ({
              trackId: sender.track.id,
              contentHint: sender.track.contentHint,
              settings: sender.track.getSettings(),
              parameters: sender.getParameters(),
            })),
          reports: selected,
        });
      }
      const sourceTracks = state.sourceStreams.flatMap((stream) =>
        stream.getVideoTracks().map((track) => ({
          id: track.id,
          readyState: track.readyState,
          muted: track.muted,
          settings: track.getSettings(),
          constraints: track.getConstraints(),
          contentHint: track.contentHint,
        }))
      );
      const screenVideo = document.getElementById('teacher-screen-video');
      const playback = screenVideo?.getVideoPlaybackQuality?.();
      const applicationSnapshot =
        typeof globalThis.professorConnectSession?.getState === 'function'
          ? await globalThis.professorConnectSession.getState()
          : typeof globalThis.professorConnectPresence?.getState === 'function'
            ? await globalThis.professorConnectPresence.getState()
            : undefined;
      const remoteControlSnapshot = applicationSnapshot?.remoteControl;
      const memory = performance.memory
        ? {
            jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
            totalJSHeapSize: performance.memory.totalJSHeapSize,
            usedJSHeapSize: performance.memory.usedJSHeapSize,
          }
        : undefined;
      return {
        peerReports,
        sourceTracks,
        drawImageCalls: state.drawImageCalls,
        rendered: {
          ...state.rendered,
          delayFromCaptureMs: state.rendered.delayFromCaptureMs.slice(-300),
          delayFromReceiveMs: state.rendered.delayFromReceiveMs.slice(-300),
          decodeMs: state.rendered.decodeMs.slice(-300),
          playback: playback
            ? {
                totalVideoFrames: playback.totalVideoFrames,
                droppedVideoFrames: playback.droppedVideoFrames,
                corruptedVideoFrames: playback.corruptedVideoFrames,
              }
            : undefined,
          readyState: screenVideo?.readyState,
          currentTime: screenVideo?.currentTime,
          paused: screenVideo?.paused,
          width: screenVideo?.videoWidth,
          height: screenVideo?.videoHeight,
        },
        windowLifecycle: {
          visibilityState: document.visibilityState,
          hasFocus: document.hasFocus(),
          remoteControlStatus: remoteControlSnapshot?.status,
          latestRemoteControlLogs: remoteControlSnapshot?.logs?.slice(-6),
          remoteInput: state.remoteInput,
        },
        memory,
      };
    })()`,
    true,
  );
}

async function collectProcessMetrics(port) {
  const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((response) =>
    response.json(),
  );
  const client = await CdpClient.connect(version.webSocketDebuggerUrl);
  try {
    const result = await client.send('SystemInfo.getProcessInfo');
    return result.processInfo.map((entry) => ({
      type: entry.type,
      id: entry.id,
      cpuTime: entry.cpuTime,
    }));
  } finally {
    client.close();
  }
}

function summarize(samples) {
  const first = samples[0];
  const last = samples.at(-1);
  const studentOutbound = findLargestVideoReport(last?.student, 'outbound-rtp');
  const teacherInbound = findLargestVideoReport(last?.teacher, 'inbound-rtp');
  const firstStudentOutbound = findLargestVideoReport(first?.student, 'outbound-rtp');
  const firstTeacherInbound = findLargestVideoReport(first?.teacher, 'inbound-rtp');
  const elapsedSeconds = Math.max(
    (Date.parse(last?.timestamp ?? startedAt) - Date.parse(first?.timestamp ?? startedAt)) / 1_000,
    1,
  );
  return {
    elapsedSeconds,
    capture: {
      sourceTracks: last?.student.sourceTracks,
      canvasDrawsPerSecond:
        ((last?.student.drawImageCalls ?? 0) - (first?.student.drawImageCalls ?? 0)) /
        elapsedSeconds,
    },
    sender: deltaSummary(firstStudentOutbound, studentOutbound, elapsedSeconds, 'Sent'),
    receiver: deltaSummary(firstTeacherInbound, teacherInbound, elapsedSeconds, 'Received'),
    renderer: last?.teacher.rendered,
  };
}

function findLargestVideoReport(metrics, type) {
  return metrics?.peerReports
    .flatMap((peer) => peer.reports)
    .filter((report) => report.type === type && report.kind === 'video')
    .sort(
      (left, right) =>
        (right.frameWidth ?? 0) * (right.frameHeight ?? 0) -
        (left.frameWidth ?? 0) * (left.frameHeight ?? 0),
    )[0];
}

function deltaSummary(first, last, elapsedSeconds, direction) {
  if (last === undefined) {
    return undefined;
  }
  const framesKey = `frames${direction}`;
  const bytesKey = `bytes${direction}`;
  return {
    ...last,
    measuredFramesPerSecond: ((last[framesKey] ?? 0) - (first?.[framesKey] ?? 0)) / elapsedSeconds,
    measuredBitrate: (((last[bytesKey] ?? 0) - (first?.[bytesKey] ?? 0)) * 8) / elapsedSeconds,
  };
}

async function waitFor(client, condition, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(client, `Boolean(${condition})`)) {
      return;
    }
    await delay(250);
  }
  const state = await evaluate(
    client,
    `({
      body: document.body.innerText.slice(0, 2_000),
      status: document.getElementById('status-message')?.textContent,
      attendance: document.getElementById('attendance-state')?.textContent,
      loginError: document.getElementById('login-error')?.textContent,
    })`,
    true,
  );
  throw new Error(`Tempo esgotado aguardando ${label}: ${JSON.stringify(state)}`);
}

async function evaluate(client, expression, awaitPromise = false) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails !== undefined) {
    throw new Error(
      result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text ??
        'Falha ao avaliar expressão no renderer.',
    );
  }
  return result.result.value;
}

async function waitForEndpoint(url) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // A porta ainda não está pronta.
    }
    await delay(250);
  }
  throw new Error(`Endpoint de depuração não ficou disponível: ${url}`);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function removeProfile(profile) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(profile, { recursive: true, force: true });
      return;
    } catch (error) {
      if (error?.code !== 'EBUSY' || attempt === 4) {
        process.stderr.write(`[audit] perfil temporário não removido: ${profile}\n`);
        return;
      }
      await delay(500);
    }
  }
}

class CdpClient {
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    return new CdpClient(socket);
  }

  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id === undefined) {
        return;
      }
      const pending = this.pending.get(message.id);
      if (pending === undefined) {
        return;
      }
      this.pending.delete(message.id);
      if (message.error !== undefined) {
        pending.reject(new Error(`${message.error.code}: ${message.error.message}`));
      } else {
        pending.resolve(message.result);
      }
    });
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) {
        pending.reject(new Error('Conexão CDP encerrada.'));
      }
      this.pending.clear();
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

await main();
