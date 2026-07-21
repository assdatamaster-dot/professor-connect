import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  WorkflowEventType,
  WorkflowState,
  type RemoteCommand,
  type ResourceReleaseReport,
  type WorkflowContext,
  type WorkflowEventListener,
  type WorkflowManagerPort,
  type WorkflowStartInput,
  type WorkflowStateListener,
} from '@professor-connect/engine';

import { StudentWorkflowController } from '../main/student-workflow.controller.js';
import { createWindowOptions } from '../main/window-options.js';
import { getTranslations } from '../renderer/i18n.js';
import { createDesktopViewModel } from '../renderer/view-model.js';
import {
  DesktopAttendanceStatus,
  DesktopConnectionStatus,
  DesktopLogCategory,
} from '../shared/contracts.js';

const START_INPUT: WorkflowStartInput = {
  student: {
    clientId: 'student-test',
    connectionId: 'student-test-connection',
    displayName: 'Aluno',
  },
  teacher: {
    clientId: 'teacher-test',
    connectionId: 'teacher-test-connection',
    displayName: 'Professor',
  },
};

test('inicializa uma janela Electron segura e o estado inicial da interface', () => {
  const options = createWindowOptions('C:\\app\\preload.cjs');
  const fixture = createFixture();
  const snapshot = fixture.controller.initialize();

  assert.equal(options.title, 'Professor Connect');
  assert.equal(options.webPreferences?.contextIsolation, true);
  assert.equal(options.webPreferences?.nodeIntegration, false);
  assert.equal(options.webPreferences?.sandbox, true);
  assert.equal(snapshot.connectionStatus, DesktopConnectionStatus.DISCONNECTED);
  assert.equal(snapshot.attendanceStatus, DesktopAttendanceStatus.IDLE);
});

test('conecta e atualiza o status quando o aluno chama um professor', async () => {
  const fixture = createFixture();

  const snapshot = await fixture.controller.callProfessor();
  const view = createDesktopViewModel(snapshot, getTranslations());

  assert.equal(fixture.manager.beginCalls, 1);
  assert.equal(snapshot.connectionStatus, DesktopConnectionStatus.CONNECTED);
  assert.equal(snapshot.attendanceStatus, DesktopAttendanceStatus.WAITING);
  assert.equal(view.connectionLabel, '🟢 Conectado');
  assert.equal(view.attendanceLabel, '🟡 Chamando');
  assert(snapshot.logs.some(({ category }) => category === DesktopLogCategory.CONNECTION));
  assert(snapshot.logs.some(({ category }) => category === DesktopLogCategory.REQUEST));
});

test('exibe mídia e controles quando o professor aceita o atendimento', async () => {
  const fixture = createFixture();

  await fixture.controller.callProfessor();
  const snapshot = await fixture.controller.acceptAttendance();
  const view = createDesktopViewModel(snapshot, getTranslations());

  assert.equal(snapshot.attendanceStatus, DesktopAttendanceStatus.ACTIVE);
  assert.equal(view.attendanceLabel, '🔵 Em atendimento');
  assert.equal(view.isMediaVisible, true);
  assert.equal(view.isShareButtonEnabled, true);
  assert.equal(view.isEndButtonEnabled, true);
  assert(snapshot.logs.some(({ category }) => category === DesktopLogCategory.VIDEO));
});

test('encerra o atendimento e oculta os recursos da chamada', async () => {
  const fixture = createFixture();

  await fixture.controller.callProfessor();
  await fixture.controller.acceptAttendance();
  const snapshot = await fixture.controller.endAttendance();

  assert.equal(fixture.manager.endCalls, 1);
  assert.equal(snapshot.attendanceStatus, DesktopAttendanceStatus.ENDED);
  assert.equal(snapshot.isMediaVisible, false);
  assert.equal(snapshot.canCallProfessor, true);
  assert.equal(snapshot.canEndAttendance, false);
});

interface TestFixture {
  readonly manager: TestWorkflowManager;
  readonly controller: StudentWorkflowController;
}

function createFixture(): TestFixture {
  const manager = new TestWorkflowManager();
  let logSequence = 0;
  const controller = new StudentWorkflowController(manager, {
    startInput: START_INPUT,
    clock: () => new Date('2026-07-20T12:00:00.000Z'),
    logIdFactory: () => `log-${++logSequence}`,
  });

  return { manager, controller };
}

class TestWorkflowManager implements WorkflowManagerPort {
  public beginCalls = 0;
  public endCalls = 0;
  private readonly eventListeners = new Set<WorkflowEventListener>();
  private readonly stateListeners = new Set<WorkflowStateListener>();
  private state = WorkflowState.IDLE;
  private context: WorkflowContext | undefined;

  public async begin(input: WorkflowStartInput): Promise<WorkflowContext> {
    this.beginCalls += 1;
    this.context = {
      workflowId: 'workflow-test',
      student: input.student,
      teacher: input.teacher,
      startedAt: '2026-07-20T12:00:00.000Z',
      requestId: 'request-test',
    };
    this.transitionTo(WorkflowState.CONNECTING);
    this.emit(WorkflowEventType.ATTENDANCE_STARTED);
    this.transitionTo(WorkflowState.REQUESTED);
    this.emit(WorkflowEventType.REQUEST_CREATED);
    return this.context;
  }

  public async accept(): Promise<WorkflowContext> {
    this.context = {
      ...this.requireContext(),
      sessionId: 'session-test',
      callId: 'call-test',
      callStartedAt: '2026-07-20T12:01:00.000Z',
    };
    this.transitionTo(WorkflowState.PREPARING);
    this.emit(WorkflowEventType.REQUEST_ACCEPTED);
    this.emit(WorkflowEventType.CALL_CREATED);
    this.transitionTo(WorkflowState.NEGOTIATING);
    this.emit(WorkflowEventType.MEDIA_STARTED);
    this.transitionTo(WorkflowState.ACTIVE);
    return this.context;
  }

  public async startScreenSharing(): Promise<void> {
    this.emit(WorkflowEventType.SCREEN_SHARING_STARTED);
  }

  public async authorizeRemoteControl(): Promise<void> {
    this.emit(WorkflowEventType.REMOTE_CONTROL_AUTHORIZED);
  }

  public sendRemoteCommand(command: RemoteCommand): void {
    void command;
  }

  public async recover(): Promise<void> {}

  public async end(): Promise<ResourceReleaseReport> {
    this.endCalls += 1;
    this.transitionTo(WorkflowState.STOPPING);
    this.context = {
      ...this.requireContext(),
      endedAt: '2026-07-20T12:10:00.000Z',
    };
    this.transitionTo(WorkflowState.COMPLETED);
    return { released: ['desktop-test'], failures: [] };
  }

  public getContext(): WorkflowContext | undefined {
    return this.context;
  }

  public getState(): WorkflowState {
    return this.state;
  }

  public getStateHistory(): readonly [] {
    return [];
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
      workflowId: 'workflow-test',
      timestamp: '2026-07-20T12:00:00.000Z',
      context: this.requireContext(),
    };

    for (const listener of this.eventListeners) {
      listener(event);
    }
  }

  private requireContext(): WorkflowContext {
    if (this.context === undefined) {
      throw new Error('Contexto de teste não iniciado');
    }
    return this.context;
  }
}
