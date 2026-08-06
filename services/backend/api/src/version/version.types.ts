export type VersionApplication = 'teacher' | 'student';
export type VersionChannel = 'stable' | 'beta' | 'development';

export interface VersionCheckInput {
  readonly currentVersion: string;
  readonly application: VersionApplication;
  readonly channel: VersionChannel;
  readonly clientId?: string | undefined;
}

export interface UpdateEventInput {
  readonly clientId: string;
  readonly application: VersionApplication;
  readonly channel: VersionChannel;
  readonly event: string;
  readonly previousVersion?: string | undefined;
  readonly newVersion?: string | undefined;
  readonly durationMilliseconds?: number | undefined;
  readonly error?: string | undefined;
  readonly userId?: string | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface PublishReleaseInput {
  readonly application: VersionApplication;
  readonly channel: VersionChannel;
  readonly version: string;
  readonly releaseNotes: Readonly<Record<string, unknown>>;
  readonly url: string;
  readonly sha512: string;
  readonly checksum: string;
  readonly signature?: string | undefined;
  readonly publishedAt?: string | undefined;
}

export interface VersionServiceContract {
  latest(application: VersionApplication, channel: VersionChannel): Promise<unknown>;
  check(input: VersionCheckInput): Promise<unknown>;
  recordEvent(input: UpdateEventInput): Promise<void>;
  metrics(): Promise<unknown>;
  publish(input: PublishReleaseInput): Promise<unknown>;
}
