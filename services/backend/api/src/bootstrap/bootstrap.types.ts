import type { AuthenticatedIdentity, RequestMetadata, TokenPair } from '../auth/auth.types.js';

export interface BootstrapStatus {
  readonly initialized: boolean;
}

export interface BootstrapImage {
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}

export interface BootstrapSetupInput {
  readonly organization: {
    readonly name: string;
    readonly tradeName?: string;
    readonly taxId?: string;
    readonly slug: string;
    readonly city: string;
    readonly state: string;
    readonly country: string;
    readonly timezone: string;
    readonly language: string;
  };
  readonly administrator: {
    readonly firstName: string;
    readonly lastName: string;
    readonly email: string;
    readonly password: string;
    readonly phone?: string;
    readonly avatar?: BootstrapImage;
  };
  readonly settings: {
    readonly systemName: string;
    readonly theme: 'light' | 'dark' | 'system';
    readonly language: string;
    readonly defaults: {
      readonly sessionDurationMinutes: number;
      readonly allowSelfRegistration: boolean;
    };
    readonly logo?: BootstrapImage;
  };
}

export interface BootstrapSetupResult {
  readonly identity: AuthenticatedIdentity;
  readonly tokens: TokenPair;
  readonly organization: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
  };
}

export interface BootstrapServiceContract {
  initialize(): Promise<BootstrapStatus>;
  setup(input: BootstrapSetupInput, metadata: RequestMetadata): Promise<BootstrapSetupResult>;
}

export class BootstrapError extends Error {
  public constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'BootstrapError';
  }
}
