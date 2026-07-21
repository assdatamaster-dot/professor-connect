import type {
  ResourceManagerDependencies,
  ResourceManagerPort,
  ResourceReleaseFailure,
  ResourceReleaseReport,
  WorkflowContext,
  WorkflowLogger,
} from './workflow.types.js';

const silentLogger: WorkflowLogger = {
  info(): void {},
  error(): void {},
};

interface ResourceReleaseStep {
  readonly resource: string;
  readonly release: () => Promise<void> | void;
}

export class ResourceManager implements ResourceManagerPort {
  private readonly listeners = new Set<() => void>();
  private readonly releasedWorkflows = new Set<string>();
  private readonly logger: WorkflowLogger;

  public constructor(private readonly dependencies: ResourceManagerDependencies) {
    this.logger = dependencies.logger ?? silentLogger;
  }

  public async release(context: WorkflowContext): Promise<ResourceReleaseReport> {
    if (this.releasedWorkflows.has(context.workflowId)) {
      return { released: [], failures: [] };
    }

    const released: string[] = [];
    const failures: ResourceReleaseFailure[] = [];

    for (const step of this.createSteps(context)) {
      try {
        await step.release();
        released.push(step.resource);
        this.logger.info('Liberação de recursos', {
          workflowId: context.workflowId,
          resource: step.resource,
        });
      } catch (error) {
        failures.push({ resource: step.resource, error });
        this.logger.error('Falhas', error);
      }
    }

    if (failures.length === 0) {
      this.releasedWorkflows.add(context.workflowId);
    }
    return { released, failures };
  }

  public registerListener(unsubscribe: () => void): () => void {
    this.listeners.add(unsubscribe);
    return () => this.listeners.delete(unsubscribe);
  }

  private createSteps(context: WorkflowContext): readonly ResourceReleaseStep[] {
    return [
      { resource: 'screen-sharing', release: () => this.dependencies.screenSharing.stop() },
      { resource: 'remote-control', release: () => this.dependencies.remoteControl.revoke() },
      {
        resource: 'call',
        release: () =>
          context.callId === undefined || !this.dependencies.call.isActive(context.callId)
            ? undefined
            : this.dependencies.call.finishCall(context.callId),
      },
      {
        resource: 'session',
        release: () =>
          context.sessionId === undefined || !this.dependencies.session.isActive(context.sessionId)
            ? undefined
            : this.dependencies.session.closeSession(context.sessionId),
      },
      { resource: 'peer-connection-media-streams', release: () => this.dependencies.rtc.close() },
      {
        resource: 'data-channel',
        release: () =>
          context.callId === undefined
            ? undefined
            : this.dependencies.dataChannel.close(context.callId),
      },
      { resource: 'heartbeat-timers', release: () => this.dependencies.heartbeat.stop() },
      { resource: 'request-timers', release: () => this.dependencies.request.cancelTimers() },
      {
        resource: 'signaling-listeners',
        release: () => this.dependencies.signaling.removeListeners(),
      },
      { resource: 'workflow-listeners', release: () => this.removeListeners() },
      { resource: 'memory', release: () => this.dependencies.memory.clear(context.workflowId) },
    ];
  }

  private removeListeners(): void {
    const listeners = [...this.listeners];

    this.listeners.clear();
    for (const unsubscribe of listeners) {
      unsubscribe();
    }
  }
}
