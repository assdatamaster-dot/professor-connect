import type { RemoteCommand } from '../remote-control/remote.types.js';
import type {
  ResourceReleaseReport,
  WorkflowContext,
  WorkflowEventListener,
  WorkflowHealthCheckPort,
  WorkflowHealthSnapshot,
  WorkflowManagerPort,
  WorkflowServicePort,
  WorkflowStartInput,
  WorkflowState,
} from './workflow.types.js';

export class WorkflowService implements WorkflowServicePort {
  public constructor(
    private readonly manager: WorkflowManagerPort,
    private readonly healthCheck: WorkflowHealthCheckPort,
  ) {}

  public begin(input: WorkflowStartInput): Promise<WorkflowContext> {
    return this.manager.begin(input);
  }

  public accept(): Promise<WorkflowContext> {
    return this.manager.accept();
  }

  public startScreenSharing(): Promise<void> {
    return this.manager.startScreenSharing();
  }

  public authorizeRemoteControl(): Promise<void> {
    return this.manager.authorizeRemoteControl();
  }

  public sendRemoteCommand(command: RemoteCommand): void {
    this.manager.sendRemoteCommand(command);
  }

  public recover(): Promise<void> {
    return this.manager.recover();
  }

  public end(): Promise<ResourceReleaseReport> {
    return this.manager.end();
  }

  public checkHealth(): WorkflowHealthSnapshot {
    return this.healthCheck.check(this.manager.getContext());
  }

  public getState(): WorkflowState {
    return this.manager.getState();
  }

  public onEvent(listener: WorkflowEventListener): () => void {
    return this.manager.onEvent(listener);
  }
}
