export interface TurnServerSettings {
  readonly enabled: boolean;
  readonly urls: readonly string[];
  readonly username?: string;
  readonly credential?: string;
}

export interface WebRtcIceSettings {
  readonly stunUrls: readonly string[];
  readonly turn: TurnServerSettings;
}

export interface WebRtcEnvironment {
  readonly WEBRTC_STUN_URLS?: string;
  readonly WEBRTC_TURN_ENABLED?: string;
  readonly WEBRTC_TURN_URLS?: string;
  readonly WEBRTC_TURN_USERNAME?: string;
  readonly WEBRTC_TURN_CREDENTIAL?: string;
}

export const DEFAULT_WEBRTC_ICE_SETTINGS: WebRtcIceSettings = Object.freeze({
  stunUrls: ['stun:stun.l.google.com:19302'],
  turn: Object.freeze({
    enabled: false,
    urls: [],
  }),
});

export function loadWebRtcIceSettings(environment: WebRtcEnvironment): WebRtcIceSettings {
  const turnEnabled = parseBoolean(environment.WEBRTC_TURN_ENABLED, false);
  const turnUrls = parseUrls(environment.WEBRTC_TURN_URLS);

  if (turnEnabled && turnUrls.length === 0) {
    throw new Error('WEBRTC_TURN_URLS é obrigatória quando WEBRTC_TURN_ENABLED=true');
  }

  return {
    stunUrls:
      environment.WEBRTC_STUN_URLS === undefined
        ? DEFAULT_WEBRTC_ICE_SETTINGS.stunUrls
        : parseUrls(environment.WEBRTC_STUN_URLS),
    turn: {
      enabled: turnEnabled,
      urls: turnUrls,
      ...(environment.WEBRTC_TURN_USERNAME === undefined
        ? {}
        : { username: environment.WEBRTC_TURN_USERNAME }),
      ...(environment.WEBRTC_TURN_CREDENTIAL === undefined
        ? {}
        : { credential: environment.WEBRTC_TURN_CREDENTIAL }),
    },
  };
}

export function createRtcConfiguration(
  settings: WebRtcIceSettings = DEFAULT_WEBRTC_ICE_SETTINGS,
): RTCConfiguration {
  const iceServers: RTCIceServer[] = [];

  if (settings.stunUrls.length > 0) {
    iceServers.push({ urls: [...settings.stunUrls] });
  }

  if (settings.turn.enabled) {
    if (settings.turn.urls.length === 0) {
      throw new Error('TURN habilitado exige ao menos uma URL');
    }

    iceServers.push({
      urls: [...settings.turn.urls],
      ...(settings.turn.username === undefined ? {} : { username: settings.turn.username }),
      ...(settings.turn.credential === undefined ? {} : { credential: settings.turn.credential }),
    });
  }

  return { iceServers };
}

function parseUrls(value: string | undefined): readonly string[] {
  if (value === undefined || value.trim().length === 0) {
    return [];
  }

  return value
    .split(',')
    .map((url) => url.trim())
    .filter((url) => url.length > 0);
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  throw new Error('WEBRTC_TURN_ENABLED deve ser true ou false');
}
