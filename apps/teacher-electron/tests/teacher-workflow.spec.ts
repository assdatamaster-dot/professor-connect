import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  WorkflowEventType,
  WorkflowState,
  type WorkflowContext,
  type WorkflowEventListener,
  type WorkflowStateListener,
} from '@professor-connect/engine';

import { TeacherWorkflowController } from '../main/teacher-workflow.controller.js';
import type { TeacherWorkflowManagerPort } from '../main/teacher-workflow.manager.js';
import { createWindowOptions } from '../main/window-options.js';
import { getTranslations } from '../renderer/i18n.js';
import { createTeacherViewModel } from '../renderer/view-model.js';
import {
  TeacherActionStatus,
  TeacherAttendanceStatus,
  TeacherConnectionStatus,
  TeacherLogCategory,
  TeacherRequestStatus,
  TeacherStudentStatus,
  type TeacherAttendanceRequest,
  type TeacherStudent,
} from '../shared/contracts.js';

test('inicializa uma janela Electron segura', async () => {
  const options = createWindowOptions('C:\\app\\preload.cjs');
  const fixture = createFixture();
  const snapshot = await fixture.controller.initialize();

  assert.equal(options.title, 'Professor Connect');
  assert.equal(options.webPreferences?.contextIsolation, true);
  assert.equal(options.webPreferences?.nodeIntegration, false);
  assert.equal(options.webPreferences?.sandbox, true);
  assert.equal(snapshot.connectionStatus, TeacherConnectionStatus.CONNECTED);
});

test('conecta o professor e lista alunos online', async () => {
  const fixture = createFixture();

  const snapshot = await fixture.controller.initialize();

  assert.equal(fixture.manager.connectCalls, 1);
  assert.equal(snapshot.onlineStudents.length, 2);
  assert.equal(snapshot.attendanceStatus, TeacherAttendanceStatus.REQUEST_PENDING);
  assert(snapshot.logs.some(({ category }) => category === TeacherLogCategory.CONNECTION));
});

test('recebe e apresenta uma solicitação de atendimento', async () => {
  const fixture = createFixture();

  const snapshot = await fixture.controller.initialize();
  const view = createTeacherViewModel(snapshot, getTranslations());

  assert.equal(snapshot.requests.length, 1);
  assert.equal(snapshot.requests[0]?.studentName, 'Ana Souza');
  assert.equal(snapshot.canAcceptRequests, true);
  assert.equal(view.connectionLabel, '🟢 Conectado');
  assert.equal(view.attendanceLabel, '🟡 Chamando');
  assert(snapshot.logs.some(({ message }) => message.includes('Solicitação recebida')));
});

test('aceita a solicitação e exibe mídia e controles', async () => {
  const fixture = createFixture();

  await fixture.controller.initialize();
  const snapshot = await fixture.controller.acceptRequest('request-ana');
  const view = createTeacherViewModel(snapshot, getTranslations());

  assert.equal(fixture.manager.acceptCalls, 1);
  assert.equal(snapshot.attendanceStatus, TeacherAttendanceStatus.ACTIVE);
  assert.equal(view.attendanceLabel, '🔵 Em atendimento');
  assert.equal(snapshot.activeStudentName, 'Ana Souza');
  assert.equal(view.isMediaVisible, true);
  assert.equal(view.canRequestScreenSharing, true);
  assert.equal(view.canRequestRemoteControl, true);
  assert(snapshot.logs.some(({ category }) => category === TeacherLogCategory.VIDEO));
});

test('recusa a solicitação e a remove da fila', async () => {
  const fixture = createFixture();

  await fixture.controller.initialize();
  const snapshot = await fixture.controller.rejectRequest('request-ana');

  assert.equal(fixture.manager.rejectCalls, 1);
  assert.equal(snapshot.requests.length, 0);
  assert.equal(snapshot.attendanceStatus, TeacherAttendanceStatus.AVAILABLE);
  assert(snapshot.logs.some(({ message }) => message.includes('recusada')));
});

test('solicita compartilhamento e controle exclusivamente pelo workflow', async () => {
  const fixture = createFixture();

  await fixture.controller.initialize();
  await fixture.controller.acceptRequest('request-ana');
  await fixture.controller.requestScreenSharing();
  const snapshot = await fixture.controller.requestRemoteControl();

  assert.equal(fixture.manager.screenSharingCalls, 1);
  assert.equal(fixture.manager.remoteControlCalls, 1);
  assert.equal(snapshot.screenSharingStatus, TeacherActionStatus.AUTHORIZED);
  assert.equal(snapshot.remoteControlStatus, TeacherActionStatus.AUTHORIZED);
});

test('encerra o atendimento e oculta os recursos da chamada', async () => {
  const fixture = createFixture();

  await fixture.controller.initialize();
  await fixture.controller.acceptRequest('request-ana');
  const snapshot = await fixture.controller.endAttendance();

  assert.equal(fixture.manager.endCalls, 1);
  assert.equal(snapshot.attendanceStatus, TeacherAttendanceStatus.AVAILABLE);
  assert.equal(snapshot.isMediaVisible, false);
  assert.equal(snapshot.canEndAttendance, false);
});

interface TestFixture {
  readonly manager: TestTeacherWorkflowManager;
  readonly controller: TeacherWorkflowController;
}

function createFixture(): TestFixture {
  const manager = new TestTeacherWorkflowManager();
  let logSequence = 0;
  const controller = new TeacherWorkflowController(manager, {
    clock: () => new Date('2026-07-20T12:00:00.000Z'),
    logIdFactory: () => `teacher-log-${++logSequence}`,
  });

  return { manager, controller };
}

class TestTeacherWorkflowManager implements TeacherWorkflowManagerPort {
  public connectCalls = 0;
  public acceptCalls = 0;
  public rejectCalls = 0;
  public screenSharingCalls = 0;
  public remoteControlCalls = 0;
  public endCalls = 0;
  private readonly eventListeners = new Set<WorkflowEventListener>();
  private readonly stateListeners = new Set<WorkflowStateListener>();
  private readonly students: readonly TeacherStudent[] = [
    {
      studentId: 'student-ana',
      displayName: 'Ana Souza',
      status: TeacherStudentStatus.AVAILABLE,
    },
    {
      studentId: 'student-bruno',
      displayName: 'Bruno Lima',
      status: TeacherStudentStatus.ONLINE,
    },
  ];
  private requests: TeacherAttendanceRequest[] = [
    {
      requestId: 'request-ana',
      studentId: 'student-ana',
      studentName: 'Ana Souza',
      createdAt: '2026-07-20T11:59:00.000Z',
      status: TeacherRequestStatus.PENDING,
    },
  ];
  private isConnected = false;
  private state = WorkflowState.IDLE;

  public async connect(): Promise<void> {
    this.connectCalls += 1;
    this.isConnected = true;
  }

  public getOnlineStudents(): readonly TeacherStudent[] {
    return this.isConnected ? this.students : [];
  }

  public getPendingRequests(): readonly TeacherAttendanceRequest[] {
    return this.isConnected ? [...this.requests] : [];
  }

  public async acceptRequest(requestId: string): Promise<void> {
    this.acceptCalls += 1;
    this.requireRequest(requestId);
    this.transitionTo(WorkflowState.CONNECTING);
    this.transitionTo(WorkflowState.REQUESTED);
    this.transitionTo(WorkflowState.PREPARING);
    this.emit(WorkflowEventType.REQUEST_ACCEPTED);
    this.emit(WorkflowEventType.CALL_CREATED);
    this.transitionTo(WorkflowState.NEGOTIATING);
    this.emit(WorkflowEventType.MEDIA_STARTED);
    this.requests = this.requests.filter((request) => request.requestId !== requestId);
    this.transitionTo(WorkflowState.ACTIVE);
  }

  public async rejectRequest(requestId: string): Promise<void> {
    this.rejectCalls += 1;
    this.requireRequest(requestId);
    this.requests = this.requests.filter((request) => request.requestId !== requestId);
  }

  public async requestScreenSharing(): Promise<void> {
    this.screenSharingCalls += 1;
    this.emit(WorkflowEventType.SCREEN_SHARING_STARTED);
  }

  public async requestRemoteControl(): Promise<void> {
    this.remoteControlCalls += 1;
    this.emit(WorkflowEventType.REMOTE_CONTROL_AUTHORIZED);
  }

  public async endAttendance(): Promise<void> {
    this.endCalls += 1;
    this.transitionTo(WorkflowState.STOPPING);
    this.transitionTo(WorkflowState.COMPLETED);
  }

  public onEvent(listener: WorkflowEventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  public onStateChanged(listener: WorkflowStateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  private transitionTo(nextState: WorkflowState): void {
    const previousState = this.state;

    this.state = nextState;
    for (const listener of this.stateListeners) {
      listener({ previousState, nextState, timestamp: '2026-07-20T12:00:00.000Z' });
    }
  }

  private emit(type: WorkflowEventType): void {
    const event = {
      type,
      workflowId: 'teacher-workflow-test',
      timestamp: '2026-07-20T12:00:00.000Z',
      context: TEST_CONTEXT,
    };

    for (const listener of this.eventListeners) {
      listener(event);
    }
  }

  private requireRequest(requestId: string): TeacherAttendanceRequest {
    const request = this.requests.find((candidate) => candidate.requestId === requestId);

    if (request === undefined) {
      throw new Error('Solicitação de teste não encontrada');
    }
    return request;
  }
}

const TEST_CONTEXT: WorkflowContext = {
  workflowId: 'teacher-workflow-test',
  student: {
    clientId: 'student-ana',
    connectionId: 'student-ana-electron',
    displayName: 'Ana Souza',
  },
  teacher: {
    clientId: 'teacher-test',
    connectionId: 'teacher-test-electron',
    displayName: 'Professor',
  },
  startedAt: '2026-07-20T12:00:00.000Z',
  requestId: 'request-ana',
  sessionId: 'session-test',
  callId: 'call-test',
};
