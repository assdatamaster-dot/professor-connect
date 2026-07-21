import {
  TeacherActionStatus,
  TeacherAttendanceStatus,
  TeacherConnectionStatus,
  TeacherStudentStatus,
} from '../shared/contracts.js';

export type SupportedLocale = 'pt-BR';

export interface TeacherTranslations {
  readonly appTitle: string;
  readonly teacherApp: string;
  readonly onlineStudents: string;
  readonly requests: string;
  readonly accept: string;
  readonly reject: string;
  readonly requestScreenSharing: string;
  readonly requestRemoteControl: string;
  readonly endAttendance: string;
  readonly localVideo: string;
  readonly remoteVideo: string;
  readonly activityLog: string;
  readonly noStudents: string;
  readonly noRequests: string;
  readonly noLogs: string;
  readonly connection: Readonly<Record<TeacherConnectionStatus, string>>;
  readonly attendance: Readonly<Record<TeacherAttendanceStatus, string>>;
  readonly studentStatus: Readonly<Record<TeacherStudentStatus, string>>;
  readonly actionStatus: Readonly<Record<TeacherActionStatus, string>>;
}

const PORTUGUESE_BRAZIL: TeacherTranslations = {
  appTitle: 'Professor Connect',
  teacherApp: 'Aplicativo do professor',
  onlineStudents: 'Alunos online',
  requests: 'Solicitações de atendimento',
  accept: 'Aceitar',
  reject: 'Recusar',
  requestScreenSharing: 'Solicitar Compartilhamento de Tela',
  requestRemoteControl: 'Solicitar Controle Remoto',
  endAttendance: 'Encerrar Atendimento',
  localVideo: 'Você',
  remoteVideo: 'Aluno',
  activityLog: 'Atividade',
  noStudents: 'Nenhum aluno online.',
  noRequests: 'Nenhuma solicitação pendente.',
  noLogs: 'Nenhuma atividade registrada.',
  connection: {
    [TeacherConnectionStatus.DISCONNECTED]: '🔴 Desconectado',
    [TeacherConnectionStatus.CONNECTING]: 'Conectando',
    [TeacherConnectionStatus.CONNECTED]: '🟢 Conectado',
    [TeacherConnectionStatus.ERROR]: 'Falha de conexão',
  },
  attendance: {
    [TeacherAttendanceStatus.IDLE]: 'Inicializando',
    [TeacherAttendanceStatus.AVAILABLE]: 'Disponível',
    [TeacherAttendanceStatus.REQUEST_PENDING]: '🟡 Chamando',
    [TeacherAttendanceStatus.PREPARING]: 'Preparando chamada',
    [TeacherAttendanceStatus.ACTIVE]: '🔵 Em atendimento',
    [TeacherAttendanceStatus.ENDING]: 'Encerrando',
    [TeacherAttendanceStatus.ENDED]: 'Atendimento encerrado',
    [TeacherAttendanceStatus.ERROR]: 'Atendimento indisponível',
  },
  studentStatus: {
    [TeacherStudentStatus.ONLINE]: 'Online',
    [TeacherStudentStatus.AVAILABLE]: 'Disponível',
    [TeacherStudentStatus.BUSY]: 'Em atendimento',
  },
  actionStatus: {
    [TeacherActionStatus.IDLE]: 'Disponível',
    [TeacherActionStatus.REQUESTED]: '🟣 Solicitado',
    [TeacherActionStatus.AUTHORIZED]: 'Autorizado',
  },
};

export function getTranslations(locale: SupportedLocale = 'pt-BR'): TeacherTranslations {
  const dictionaries: Readonly<Record<SupportedLocale, TeacherTranslations>> = {
    'pt-BR': PORTUGUESE_BRAZIL,
  };

  return dictionaries[locale];
}
