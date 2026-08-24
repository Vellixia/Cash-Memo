export const E2E_AUTH_RATE_LIMIT: string;

export interface E2EApiEnvironmentOptions {
  databaseUrl: string;
  publicOrigin: string;
  smtpPort: string;
}

export function buildE2eApiEnvironment(
  parentEnvironment: Record<string, string | undefined>,
  options: E2EApiEnvironmentOptions,
): Record<string, string | undefined>;
