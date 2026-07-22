export interface WebRtcSessionDescription {
  readonly type: 'offer' | 'answer';
  readonly sdp: string;
}

export interface WebRtcDescriptionPayload {
  readonly sessionId: string;
  readonly description: WebRtcSessionDescription;
}

export interface WebRtcIceCandidate {
  readonly candidate: string;
  readonly sdpMid: string | null;
  readonly sdpMLineIndex: number | null;
  readonly usernameFragment: string | null;
}

export interface WebRtcIceCandidatePayload {
  readonly sessionId: string;
  readonly candidate: WebRtcIceCandidate;
}

export interface ScreenSharePayload {
  readonly sessionId: string;
  readonly streamId?: string;
  readonly trackId?: string;
}

export type WebRtcDescriptionListener = (payload: WebRtcDescriptionPayload) => void;
export type WebRtcIceCandidateListener = (payload: WebRtcIceCandidatePayload) => void;

export interface StudentWebRtcApi {
  sendOffer(payload: WebRtcDescriptionPayload): Promise<void>;
  sendAnswer(payload: WebRtcDescriptionPayload): Promise<void>;
  sendIceCandidate(payload: WebRtcIceCandidatePayload): Promise<void>;
  sendScreenShareStart(payload: ScreenSharePayload): Promise<void>;
  sendScreenShareStop(payload: ScreenSharePayload): Promise<void>;
  onOffer(listener: WebRtcDescriptionListener): () => void;
  onAnswer(listener: WebRtcDescriptionListener): () => void;
  onIceCandidate(listener: WebRtcIceCandidateListener): () => void;
}
