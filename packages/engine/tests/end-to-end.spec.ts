import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  EndToEndEventType,
  EndToEndManager,
  EndToEndResource,
  EndToEndRole,
  EndToEndState,
  type EndToEndAttendance,
  type EndToEndClient,
  type EndToEndEvent,
  type EndToEndResourceManagerPort,
  type EndToEndResourceReleaseReport,
  type EndToEndWorkflowPort,
} from '../src/index.js';
import {
  ClientRole,
  PresenceStatus,
  RequestStatus,
  type ClientPresence,
  type ServiceRequest,
} from '@professor-connect/protocol';

const STUDENT: EndToEndClient = {
  clientId: 'student-e2e',
  displayName: 'Aluno E2E',
  role: EndToEndRole.STUDENT,
};

const TEACHER: EndToEndClient = {
  clientId: 'teacher-e2e',
  displayName: 'Professor E2E',
  role: EndToEndRole.TEACHER,
};

const REQUEST: ServiceRequest = {
  requestId: 'request-e2e',
  studentId: STUDENT.clientId,
  status: RequestStatus.PENDING,
  createdAt: '2026-07-20T12:00:00.000Z',
  expiresAt: '2026-07-20T12:01:00.000Z',
};

const ATTENDANCE: EndToEndAttendance = {
  requestId: REQUEST.requestId,
  sessionId: 'session-e2e',
  callId: 'call-e2e',
  studentId: STUDENT.clientId,
  teacherId: TEACHER.clientId,
};

test('integra dois clientes, Request, Session, Call, WebRTC, mídia, tela e encerramento', async () => {
  const server = new TestIntegrationServer();
  const studentFixture = createFixture(STUDENT, server);
  const teacherFixture = createFixture(TEACHER, server);

  const studentConnected = await studentFixture.manager.connect(STUDENT);
  const teacherConnected = await teacherFixture.manager.connect(TEACHER);

  assert.equal(studentConnected.state, EndToEndState.CONNECTED);
  assert.equal(teacherConnected.state, EndToEndState.CONNECTED);
  assert.equal(teacherConnected.onlineStudents[0]?.clientId, STUDENT.clientId);

  const request = await studentFixture.manager.callProfessor();

  teacherFixture.manager.receiveRequest(request);
  const attendance = await teacherFixture.manager.acceptRequest(request.requestId);

  await studentFixture.manager.receiveAcceptedAttendance(attendance);

  for (const fixture of [studentFixture, teacherFixture]) {
    const snapshot = fixture.manager.getSnapshot();

    assert.equal(snapshot.state, EndToEndState.IN_ATTENDANCE);
    assert.equal(snapshot.attendance?.sessionId, ATTENDANCE.sessionId);
    assert.equal(snapshot.attendance?.callId, ATTENDANCE.callId);
    assert.equal(snapshot.hasAudio, true);
    assert.equal(snapshot.hasVideo, true);
    assertEvent(fixture.events, EndToEndEventType.SESSION_CREATED);
    assertEvent(fixture.events, EndToEndEventType.CALL_CREATED);
    assertEvent(fixture.events, EndToEndEventType.SIGNALING_STARTED);
    assertEvent(fixture.events, EndToEndEventType.WEBRTC_CONNECTED);
    assertEvent(fixture.events, EndToEndEventType.AUDIO_STARTED);
    assertEvent(fixture.events, EndToEndEventType.VIDEO_STARTED);
  }

  await studentFixture.manager.shareScreen();
  assert.equal(studentFixture.manager.getSnapshot().state, EndToEndState.SHARING);
  assert.equal(studentFixture.manager.getSnapshot().isSharingScreen, true);

  const studentRelease = await studentFixture.manager.endAttendance();
  const teacherRelease = await teacherFixture.manager.endAttendance();

  assertReleasedEverything(studentRelease);
  assertReleasedEverything(teacherRelease);
  assert.equal(studentFixture.manager.getSnapshot().state, EndToEndState.CONNECTED);
  assert.equal(teacherFixture.manager.getSnapshot().state, EndToEndState.CONNECTED);
  assert.equal(studentFixture.manager.getSnapshot().attendance, undefined);
  assert.equal(teacherFixture.manager.getSnapshot().attendance, undefined);

  await studentFixture.manager.disconnect();
  await teacherFixture.manager.disconnect();
  assert.equal(studentFixture.manager.getSnapshot().state, EndToEndState.DISCONNECTED);
  assert.equal(teacherFixture.manager.getSnapshot().state, EndToEndState.DISCONNECTED);
});

test('reconecta o atendimento e restaura WebRTC, áudio e vídeo', async () => {
  const server = new TestIntegrationServer();
  const studentFixture = createFixture(STUDENT, server);
  const teacherFixture = createFixture(TEACHER, server);

  await studentFixture.manager.connect(STUDENT);
  await teacherFixture.manager.connect(TEACHER);
  const request = await studentFixture.manager.callProfessor();

  teacherFixture.manager.receiveRequest(request);
  const attendance = await teacherFixture.manager.acceptRequest(request.requestId);

  await studentFixture.manager.receiveAcceptedAttendance(attendance);
  await studentFixture.manager.reconnect();

  assert.equal(studentFixture.workflow.reconnectCalls, 1);
  assert.equal(studentFixture.manager.getSnapshot().state, EndToEndState.IN_ATTENDANCE);
  assertEvent(studentFixture.events, EndToEndEventType.CONNECTION_LOST);
  assertEvent(studentFixture.events, EndToEndEventType.RECONNECTED);
});

test('falha quando o Resource Manager não libera todos os recursos', async () => {
  const server = new TestIntegrationServer();
  const resources = new TestResourceManager([EndToEndResource.PEER_CONNECTION]);
  const workflow = new TestWorkflowPort(STUDENT, server);
  const manager = new EndToEndManager(workflow, resources);

  await manager.connect(STUDENT);
  await manager.callProfessor();
  await manager.receiveAcceptedAttendance(ATTENDANCE);
  const report = await manager.endAttendance();

  assert.equal(report.failures.length, 0);
  assert.equal(manager.getSnapshot().state, EndToEndState.FAILED);
});

interface TestFixture {
  readonly manager: EndToEndManager;
  readonly workflow: TestWorkflowPort;
  readonly resources: TestResourceManager;
  readonly events: EndToEndEvent[];
}

function createFixture(client: EndToEndClient, server: TestIntegrationServer): TestFixture {
  const workflow = new TestWorkflowPort(client, server);
  const resources = new TestResourceManager(Object.values(EndToEndResource));
  const manager = new EndToEndManager(workflow, resources, {
    clock: () => new Date('2026-07-20T12:00:00.000Z'),
  });
  const events: EndToEndEvent[] = [];

  manager.onEvent((event) => events.push(event));
  return { manager, workflow, resources, events };
}

class TestIntegrationServer {
  private readonly clients = new Map<string, EndToEndClient>();

  public connect(client: EndToEndClient): void {
    this.clients.set(client.clientId, client);
  }

  public listStudents(): readonly ClientPresence[] {
    return [...this.clients.values()]
      .filter(({ role }) => role === EndToEndRole.STUDENT)
      .map((client) => ({
        clientId: client.clientId,
        connectionId: `${client.clientId}-connection`,
        displayName: client.displayName,
        role: ClientRole.STUDENT,
        status: PresenceStatus.ONLINE,
        lastSeen: '2026-07-20T12:00:00.000Z',
      }));
  }
}

class TestWorkflowPort implements EndToEndWorkflowPort {
  public reconnectCalls = 0;
  private connected = false;
  private presenceRegistered = false;
  private rtcConnected = false;

  public constructor(
    private readonly client: EndToEndClient,
    private readonly server: TestIntegrationServer,
  ) {}

  public async connect(client: EndToEndClient): Promise<void> {
    assert.equal(client.clientId, this.client.clientId);
    this.server.connect(client);
    this.connected = true;
  }

  public async registerPresence(client: EndToEndClient): Promise<void> {
    assert.equal(this.connected, true);
    assert.equal(client.clientId, this.client.clientId);
    this.presenceRegistered = true;
  }

  public async listOnlineStudents(): Promise<readonly ClientPresence[]> {
    assert.equal(this.presenceRegistered, true);
    return this.server.listStudents();
  }

  public async createRequest(): Promise<ServiceRequest> {
    assert.equal(this.client.role, EndToEndRole.STUDENT);
    return REQUEST;
  }

  public async acceptRequest(requestId: string): Promise<EndToEndAttendance> {
    assert.equal(this.client.role, EndToEndRole.TEACHER);
    assert.equal(requestId, REQUEST.requestId);
    return ATTENDANCE;
  }

  public async rejectRequest(requestId: string): Promise<void> {
    assert.equal(requestId, REQUEST.requestId);
  }

  public async prepareSignaling(attendance: EndToEndAttendance): Promise<void> {
    assert.equal(attendance.callId, ATTENDANCE.callId);
  }

  public async connectRtc(attendance: EndToEndAttendance, initiator: boolean): Promise<void> {
    assert.equal(attendance.sessionId, ATTENDANCE.sessionId);
    assert.equal(initiator, this.client.role === EndToEndRole.TEACHER);
    this.rtcConnected = true;
  }

  public async reconnectRtc(attendance: EndToEndAttendance): Promise<void> {
    assert.equal(attendance.callId, ATTENDANCE.callId);
    this.reconnectCalls += 1;
    this.rtcConnected = true;
  }

  public hasAudio(): boolean {
    return this.rtcConnected;
  }

  public hasVideo(): boolean {
    return this.rtcConnected;
  }

  public async startScreenSharing(attendance: EndToEndAttendance): Promise<void> {
    assert.equal(attendance.callId, ATTENDANCE.callId);
  }

  public async disconnect(): Promise<void> {
    this.connected = false;
    this.rtcConnected = false;
  }
}

class TestResourceManager implements EndToEndResourceManagerPort {
  public constructor(private readonly released: readonly EndToEndResource[]) {}

  public async release(): Promise<EndToEndResourceReleaseReport> {
    return { released: [...this.released], failures: [] };
  }
}

function assertEvent(events: readonly EndToEndEvent[], type: EndToEndEventType): void {
  assert(
    events.some((event) => event.type === type),
    `Evento ausente: ${type}`,
  );
}

function assertReleasedEverything(report: EndToEndResourceReleaseReport): void {
  assert.equal(report.failures.length, 0);
  assert.deepEqual(new Set(report.released), new Set(Object.values(EndToEndResource)));
}
