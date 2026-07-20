import {
  WorkflowHealthComponent,
  WorkflowHealthStatus,
  type WorkflowContext,
  type WorkflowHealthCheckDependencies,
  type WorkflowHealthCheckPort,
  type WorkflowHealthComponentResult,
  type WorkflowHealthSnapshot,
} from './workflow.types.js';

export class HealthCheckService implements WorkflowHealthCheckPort {
  public constructor(
    private readonly dependencies: WorkflowHealthCheckDependencies,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  public check(context: WorkflowContext | undefined): WorkflowHealthSnapshot {
    const components = this.createComponents(context);

    return {
      status: components.every((component) => component.healthy)
        ? WorkflowHealthStatus.HEALTHY
        : WorkflowHealthStatus.UNHEALTHY,
      timestamp: this.clock().toISOString(),
      components,
    };
  }

  private createComponents(
    context: WorkflowContext | undefined,
  ): readonly WorkflowHealthComponentResult[] {
    const sessionId = context?.sessionId;
    const callId = context?.callId;

    return [
      this.component(
        WorkflowHealthComponent.SOCKET_IO,
        context !== undefined && this.dependencies.connection.areSocketsConnected(context),
      ),
      this.component(
        WorkflowHealthComponent.HEARTBEAT,
        context !== undefined && this.dependencies.heartbeat.isHealthy(context),
      ),
      this.component(
        WorkflowHealthComponent.CALL,
        callId !== undefined && this.dependencies.call.isActive(callId),
      ),
      this.component(
        WorkflowHealthComponent.SESSION,
        sessionId !== undefined && this.dependencies.session.isActive(sessionId),
      ),
      this.component(
        WorkflowHealthComponent.PEER_CONNECTION,
        this.dependencies.rtc.isPeerConnected(),
      ),
      this.component(
        WorkflowHealthComponent.DATA_CHANNEL,
        callId !== undefined && this.dependencies.dataChannel.isOpen(callId),
      ),
      this.component(
        WorkflowHealthComponent.MEDIA_STREAMS,
        this.dependencies.rtc.hasMediaStreams(),
      ),
    ];
  }

  private component(
    component: WorkflowHealthComponent,
    healthy: boolean,
  ): WorkflowHealthComponentResult {
    return { component, healthy };
  }
}
