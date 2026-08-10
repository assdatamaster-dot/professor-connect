import type { Server as HttpServer } from 'node:http';
import type { ManagerOptions, SocketOptions } from 'socket.io-client';

import {
  initializeWebSocket,
  type CommunicationLogger,
  type SocketAuthenticationOptions,
} from '../src/index.js';

type Initialize = Parameters<typeof initializeWebSocket>;
export interface TestWebSocketOptions {
  readonly requestTimeout?: Initialize[2];
  readonly heartbeat?: Initialize[3];
  readonly professors?: Initialize[4];
  readonly students?: Initialize[5];
  readonly requests?: Initialize[6];
  readonly sessions?: Initialize[7];
  readonly remoteControlTimeout?: Initialize[8];
  readonly workflowPersistence?: Initialize[9];
  readonly fileTransferPersistence?: Initialize[10];
}

export function initializeTestWebSocket(
  httpServer: HttpServer,
  logger: CommunicationLogger,
  options: TestWebSocketOptions = {},
) {
  return initializeWebSocket(
    httpServer,
    logger,
    options.requestTimeout,
    options.heartbeat,
    options.professors,
    options.students,
    options.requests,
    options.sessions,
    options.remoteControlTimeout,
    options.workflowPersistence,
    options.fileTransferPersistence,
    TEST_AUTHENTICATION,
  );
}

export const TEST_AUTHENTICATION: SocketAuthenticationOptions = {
  authenticate(token) {
    const [
      role = 'STUDENT',
      profileId = 'test-client',
      organizationId = 'organization-test',
      ...nameParts
    ] = token.split(':');
    if (role !== 'TEACHER' && role !== 'STUDENT')
      return Promise.reject(new Error('invalid test token'));
    return Promise.resolve({
      userId: `user-${profileId}`,
      organizationId,
      displayName: nameParts.join(':') || profileId,
      roles: [role],
      permissions: [
        'socket.connect',
        'session.request',
        'session.respond',
        'webrtc.use',
        'remote-control.request',
        'remote-control.approve',
        'files.transfer',
        'students.online.read',
      ],
      profileId,
      sessionFamilyId: `session-${profileId}`,
    });
  },
};

export function authenticatedSocketOptions(
  role: 'TEACHER' | 'STUDENT',
  profileId: string,
  displayName = profileId,
  organizationId = 'organization-test',
): Partial<ManagerOptions & SocketOptions> {
  return {
    transports: ['websocket'],
    auth: { token: `${role}:${profileId}:${organizationId}:${displayName}` },
  };
}
