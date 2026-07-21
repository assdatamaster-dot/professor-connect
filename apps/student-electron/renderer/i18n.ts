import {
  DesktopAttendanceStatus,
  DesktopConnectionStatus,
  DesktopRemoteControlStatus,
} from '../shared/contracts.js';

export type SupportedLocale = 'pt-BR';

export interface DesktopTranslations {
  readonly appTitle: string;
  readonly studentApp: string;
  readonly callProfessor: string;
  readonly shareScreen: string;
  readonly sharingScreen: string;
  readonly endAttendance: string;
  readonly localVideo: string;
  readonly remoteVideo: string;
  readonly remoteControl: string;
  readonly activityLog: string;
  readonly noLogs: string;
  readonly connection: Readonly<Record<DesktopConnectionStatus, string>>;
  readonly attendance: Readonly<Record<DesktopAttendanceStatus, string>>;
  readonly remote: Readonly<Record<DesktopRemoteControlStatus, string>>;
}

const PORTUGUESE_BRAZIL: DesktopTranslations = {
  appTitle: 'Professor Connect',
  studentApp: 'Aplicativo do aluno',
  callProfessor: 'CHAMAR PROFESSOR',
  shareScreen: 'Compartilhar Tela',
  sharingScreen: '🟣 Compartilhando Tela',
  endAttendance: 'Encerrar Atendimento',
  localVideo: 'Você',
  remoteVideo: 'Professor',
  remoteControl: 'Controle remoto',
  activityLog: 'Atividade',
  noLogs: 'Nenhuma atividade registrada.',
  connection: {
    [DesktopConnectionStatus.DISCONNECTED]: '🔴 Desconectado',
    [DesktopConnectionStatus.CONNECTING]: 'Conectando',
    [DesktopConnectionStatus.CONNECTED]: '🟢 Conectado',
    [DesktopConnectionStatus.ERROR]: 'Falha de conexão',
  },
  attendance: {
    [DesktopAttendanceStatus.IDLE]: 'Disponível',
    [DesktopAttendanceStatus.REQUESTING]: '🟡 Chamando',
    [DesktopAttendanceStatus.WAITING]: '🟡 Chamando',
    [DesktopAttendanceStatus.PREPARING]: 'Preparando chamada',
    [DesktopAttendanceStatus.ACTIVE]: '🔵 Em atendimento',
    [DesktopAttendanceStatus.ENDING]: 'Encerrando',
    [DesktopAttendanceStatus.ENDED]: 'Atendimento encerrado',
    [DesktopAttendanceStatus.ERROR]: 'Atendimento indisponível',
  },
  remote: {
    [DesktopRemoteControlStatus.NOT_AUTHORIZED]: 'Não autorizado',
    [DesktopRemoteControlStatus.AUTHORIZED]: 'Autorizado',
  },
};

export function getTranslations(locale: SupportedLocale = 'pt-BR'): DesktopTranslations {
  const dictionaries: Readonly<Record<SupportedLocale, DesktopTranslations>> = {
    'pt-BR': PORTUGUESE_BRAZIL,
  };

  return dictionaries[locale];
}
