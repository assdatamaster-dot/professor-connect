import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';

import type { ProfessorPresenceSnapshot } from '../shared/presence-contracts.js';
import { PRESENCE_IPC_CHANNELS } from '../shared/presence-ipc-channels.js';
import type {
  RemoteControlKeyboardEvent,
  RemoteControlMouseEvent,
} from '../shared/remote-control-contracts.js';
import type { ProfessorPresenceController } from './professor-presence.controller.js';
import type {
  WebRtcDescriptionPayload,
  WebRtcIceCandidatePayload,
} from '../shared/webrtc-contracts.js';

export interface PresenceIpcRegistration {
  dispose(): void;
}

export function registerPresenceIpc(
  controller: ProfessorPresenceController,
  renderer: WebContents,
): PresenceIpcRegistration {
  const assertSender = (event: IpcMainInvokeEvent): void => {
    if (event.sender.id !== renderer.id) {
      throw new Error('Origem IPC não autorizada');
    }
  };

  ipcMain.handle(PRESENCE_IPC_CHANNELS.CONNECT, async (event, name: unknown) => {
    assertSender(event);
    if (typeof name !== 'string') {
      throw new Error('Nome do professor inválido');
    }
    return controller.connect(name);
  });
  ipcMain.handle(PRESENCE_IPC_CHANNELS.DISCONNECT, (event): ProfessorPresenceSnapshot => {
    assertSender(event);
    return controller.disconnect();
  });
  ipcMain.handle(PRESENCE_IPC_CHANNELS.GET_STATE, (event): ProfessorPresenceSnapshot => {
    assertSender(event);
    return controller.getSnapshot();
  });
  ipcMain.handle(PRESENCE_IPC_CHANNELS.ACCEPT_SESSION, (event, requestId: unknown) => {
    assertSender(event);
    if (typeof requestId !== 'string') {
      throw new Error('Solicitação inválida');
    }
    return controller.acceptSession(requestId);
  });
  ipcMain.handle(PRESENCE_IPC_CHANNELS.REJECT_SESSION, (event, requestId: unknown) => {
    assertSender(event);
    if (typeof requestId !== 'string') {
      throw new Error('Solicitação inválida');
    }
    return controller.rejectSession(requestId);
  });
  ipcMain.handle(PRESENCE_IPC_CHANNELS.END_SESSION, (event) => {
    assertSender(event);
    return controller.endSession();
  });
  ipcMain.handle(PRESENCE_IPC_CHANNELS.WEBRTC_SEND_OFFER, (event, payload: unknown) => {
    assertSender(event);
    controller.sendWebRtcOffer(requireDescriptionPayload(payload));
  });
  ipcMain.handle(PRESENCE_IPC_CHANNELS.WEBRTC_SEND_ANSWER, (event, payload: unknown) => {
    assertSender(event);
    controller.sendWebRtcAnswer(requireDescriptionPayload(payload, 'answer'));
  });
  ipcMain.handle(PRESENCE_IPC_CHANNELS.WEBRTC_SEND_ICE, (event, payload: unknown) => {
    assertSender(event);
    controller.sendWebRtcIceCandidate(requireIceCandidatePayload(payload));
  });
  ipcMain.handle(PRESENCE_IPC_CHANNELS.REMOTE_CONTROL_REQUEST, (event) => {
    assertSender(event);
    return controller.requestRemoteControl();
  });
  ipcMain.handle(PRESENCE_IPC_CHANNELS.REMOTE_CONTROL_MOUSE, (event, payload: unknown) => {
    assertSender(event);
    controller.sendRemoteControlMouse(requireRemoteControlMouseEvent(payload));
  });
  ipcMain.handle(PRESENCE_IPC_CHANNELS.REMOTE_CONTROL_KEYBOARD, (event, payload: unknown) => {
    assertSender(event);
    controller.sendRemoteControlKeyboard(requireRemoteControlKeyboardEvent(payload));
  });
  ipcMain.handle(PRESENCE_IPC_CHANNELS.REMOTE_CONTROL_STOP, (event) => {
    assertSender(event);
    return controller.stopRemoteControl();
  });

  const unsubscribe = controller.onStateChanged((snapshot) => {
    if (!renderer.isDestroyed()) {
      renderer.send(PRESENCE_IPC_CHANNELS.STATE_CHANGED, snapshot);
    }
  });
  const unsubscribeAnswer = controller.onWebRtcAnswer((payload) => {
    if (!renderer.isDestroyed()) {
      renderer.send(PRESENCE_IPC_CHANNELS.WEBRTC_ANSWER, payload);
    }
  });
  const unsubscribeOffer = controller.onWebRtcOffer((payload) => {
    if (!renderer.isDestroyed()) {
      renderer.send(PRESENCE_IPC_CHANNELS.WEBRTC_OFFER, payload);
    }
  });
  const unsubscribeIce = controller.onWebRtcIceCandidate((payload) => {
    if (!renderer.isDestroyed()) {
      renderer.send(PRESENCE_IPC_CHANNELS.WEBRTC_ICE, payload);
    }
  });
  const unsubscribeScreenShareStarted = controller.onScreenShareStarted((payload) => {
    if (!renderer.isDestroyed()) {
      renderer.send(PRESENCE_IPC_CHANNELS.SCREEN_SHARE_STARTED, payload);
    }
  });
  const unsubscribeScreenShareStopped = controller.onScreenShareStopped((payload) => {
    if (!renderer.isDestroyed()) {
      renderer.send(PRESENCE_IPC_CHANNELS.SCREEN_SHARE_STOPPED, payload);
    }
  });

  return {
    dispose(): void {
      unsubscribe();
      unsubscribeAnswer();
      unsubscribeOffer();
      unsubscribeIce();
      unsubscribeScreenShareStarted();
      unsubscribeScreenShareStopped();
      ipcMain.removeHandler(PRESENCE_IPC_CHANNELS.CONNECT);
      ipcMain.removeHandler(PRESENCE_IPC_CHANNELS.DISCONNECT);
      ipcMain.removeHandler(PRESENCE_IPC_CHANNELS.GET_STATE);
      ipcMain.removeHandler(PRESENCE_IPC_CHANNELS.ACCEPT_SESSION);
      ipcMain.removeHandler(PRESENCE_IPC_CHANNELS.REJECT_SESSION);
      ipcMain.removeHandler(PRESENCE_IPC_CHANNELS.END_SESSION);
      ipcMain.removeHandler(PRESENCE_IPC_CHANNELS.WEBRTC_SEND_OFFER);
      ipcMain.removeHandler(PRESENCE_IPC_CHANNELS.WEBRTC_SEND_ANSWER);
      ipcMain.removeHandler(PRESENCE_IPC_CHANNELS.WEBRTC_SEND_ICE);
      ipcMain.removeHandler(PRESENCE_IPC_CHANNELS.REMOTE_CONTROL_REQUEST);
      ipcMain.removeHandler(PRESENCE_IPC_CHANNELS.REMOTE_CONTROL_MOUSE);
      ipcMain.removeHandler(PRESENCE_IPC_CHANNELS.REMOTE_CONTROL_KEYBOARD);
      ipcMain.removeHandler(PRESENCE_IPC_CHANNELS.REMOTE_CONTROL_STOP);
    },
  };
}

function requireDescriptionPayload(
  payload: unknown,
  expectedType: 'offer' | 'answer' = 'offer',
): WebRtcDescriptionPayload {
  const record = requireRecord(payload);
  const description = requireRecord(record.description);
  if (
    typeof record.sessionId !== 'string' ||
    description.type !== expectedType ||
    typeof description.sdp !== 'string'
  ) {
    throw new Error('Descrição WebRTC inválida');
  }
  return {
    sessionId: record.sessionId,
    description: { type: expectedType, sdp: description.sdp },
  };
}

function requireIceCandidatePayload(payload: unknown): WebRtcIceCandidatePayload {
  const record = requireRecord(payload);
  const candidate = requireRecord(record.candidate);
  if (typeof record.sessionId !== 'string' || typeof candidate.candidate !== 'string') {
    throw new Error('ICE Candidate inválido');
  }
  return {
    sessionId: record.sessionId,
    candidate: {
      candidate: candidate.candidate,
      sdpMid: typeof candidate.sdpMid === 'string' ? candidate.sdpMid : null,
      sdpMLineIndex: typeof candidate.sdpMLineIndex === 'number' ? candidate.sdpMLineIndex : null,
      usernameFragment:
        typeof candidate.usernameFragment === 'string' ? candidate.usernameFragment : null,
    },
  };
}

function requireRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Payload WebRTC inválido');
  }
  return value as Readonly<Record<string, unknown>>;
}

function requireRemoteControlMouseEvent(payload: unknown): RemoteControlMouseEvent {
  const record = requireRecord(payload);
  if (
    (record.type !== 'mousemove' &&
      record.type !== 'mousedown' &&
      record.type !== 'mouseup' &&
      record.type !== 'wheel') ||
    !isFiniteNumber(record.x) ||
    !isFiniteNumber(record.y) ||
    !isInteger(record.button) ||
    !isInteger(record.buttons)
  ) {
    throw new Error('Evento de mouse inválido');
  }
  return {
    type: record.type,
    x: record.x,
    y: record.y,
    button: record.button,
    buttons: record.buttons,
    ...(isFiniteNumber(record.deltaX) ? { deltaX: record.deltaX } : {}),
    ...(isFiniteNumber(record.deltaY) ? { deltaY: record.deltaY } : {}),
    ...(isInteger(record.deltaMode) ? { deltaMode: record.deltaMode } : {}),
  };
}

function requireRemoteControlKeyboardEvent(payload: unknown): RemoteControlKeyboardEvent {
  const record = requireRecord(payload);
  if (
    (record.type !== 'keydown' && record.type !== 'keyup') ||
    typeof record.key !== 'string' ||
    typeof record.code !== 'string' ||
    typeof record.repeat !== 'boolean' ||
    typeof record.altKey !== 'boolean' ||
    typeof record.ctrlKey !== 'boolean' ||
    typeof record.shiftKey !== 'boolean' ||
    typeof record.metaKey !== 'boolean'
  ) {
    throw new Error('Evento de teclado inválido');
  }
  return {
    type: record.type,
    key: record.key,
    code: record.code,
    repeat: record.repeat,
    altKey: record.altKey,
    ctrlKey: record.ctrlKey,
    shiftKey: record.shiftKey,
    metaKey: record.metaKey,
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}
