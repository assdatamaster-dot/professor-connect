import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';

import type { StudentSessionSnapshot } from '../shared/session-contracts.js';
import { SESSION_IPC_CHANNELS } from '../shared/session-ipc-channels.js';
import type { StudentPresenceController } from './student-presence.controller.js';
import type {
  WebRtcDescriptionPayload,
  WebRtcIceCandidatePayload,
} from '../shared/webrtc-contracts.js';

export interface SessionIpcRegistration {
  dispose(): void;
}

export function registerSessionIpc(
  controller: StudentPresenceController,
  renderer: WebContents,
): SessionIpcRegistration {
  const assertSender = (event: IpcMainInvokeEvent): void => {
    if (event.sender.id !== renderer.id) {
      throw new Error('Origem IPC não autorizada');
    }
  };

  ipcMain.handle(SESSION_IPC_CHANNELS.GET_TEACHERS, (event) => {
    assertSender(event);
    return controller.getOnlineTeachers();
  });
  ipcMain.handle(SESSION_IPC_CHANNELS.REQUEST, (event, teacherId: unknown) => {
    assertSender(event);
    if (typeof teacherId !== 'string') {
      throw new Error('Professor inválido');
    }
    return controller.requestSession(teacherId);
  });
  ipcMain.handle(SESSION_IPC_CHANNELS.GET_STATE, (event): StudentSessionSnapshot => {
    assertSender(event);
    return controller.getSessionSnapshot();
  });
  ipcMain.handle(SESSION_IPC_CHANNELS.END, (event): StudentSessionSnapshot => {
    assertSender(event);
    return controller.endSession();
  });
  ipcMain.handle(SESSION_IPC_CHANNELS.WEBRTC_SEND_ANSWER, (event, payload: unknown) => {
    assertSender(event);
    controller.sendWebRtcAnswer(requireDescriptionPayload(payload, 'answer'));
  });
  ipcMain.handle(SESSION_IPC_CHANNELS.WEBRTC_SEND_ICE, (event, payload: unknown) => {
    assertSender(event);
    controller.sendWebRtcIceCandidate(requireIceCandidatePayload(payload));
  });

  const unsubscribe = controller.onSessionStateChanged((snapshot) => {
    if (!renderer.isDestroyed()) {
      renderer.send(SESSION_IPC_CHANNELS.STATE_CHANGED, snapshot);
    }
  });
  const unsubscribeOffer = controller.onWebRtcOffer((payload) => {
    if (!renderer.isDestroyed()) {
      renderer.send(SESSION_IPC_CHANNELS.WEBRTC_OFFER, payload);
    }
  });
  const unsubscribeIce = controller.onWebRtcIceCandidate((payload) => {
    if (!renderer.isDestroyed()) {
      renderer.send(SESSION_IPC_CHANNELS.WEBRTC_ICE, payload);
    }
  });

  return {
    dispose(): void {
      unsubscribe();
      unsubscribeOffer();
      unsubscribeIce();
      ipcMain.removeHandler(SESSION_IPC_CHANNELS.GET_TEACHERS);
      ipcMain.removeHandler(SESSION_IPC_CHANNELS.REQUEST);
      ipcMain.removeHandler(SESSION_IPC_CHANNELS.GET_STATE);
      ipcMain.removeHandler(SESSION_IPC_CHANNELS.END);
      ipcMain.removeHandler(SESSION_IPC_CHANNELS.WEBRTC_SEND_ANSWER);
      ipcMain.removeHandler(SESSION_IPC_CHANNELS.WEBRTC_SEND_ICE);
    },
  };
}

function requireDescriptionPayload(
  payload: unknown,
  expectedType: 'answer',
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
