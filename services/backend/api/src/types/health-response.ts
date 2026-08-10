export interface HealthResponse {
  status: 'ok';
  version: string;
  gitSha: string;
  buildDate: string;
  environment: string;
}
