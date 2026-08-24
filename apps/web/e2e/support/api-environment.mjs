export const E2E_AUTH_RATE_LIMIT = "100";

export function buildE2eApiEnvironment(parentEnvironment, options) {
  return {
    ...parentEnvironment,
    CASHMEMO_V1_APP_ENV: "test",
    CASHMEMO_V1_DATABASE_URL: options.databaseUrl,
    CASHMEMO_V1_BIND_ADDR: "127.0.0.1:3001",
    CASHMEMO_V1_PUBLIC_ORIGIN: options.publicOrigin,
    CASHMEMO_V1_ALLOWED_ORIGINS: options.publicOrigin,
    CASHMEMO_V1_SMTP_HOST: "127.0.0.1",
    CASHMEMO_V1_SMTP_PORT: options.smtpPort,
    CASHMEMO_V1_SMTP_FROM: "Cashmemo E2E <cashmemo-e2e@example.test>",
    CASHMEMO_V1_SMTP_SECURITY: "plaintext",
    CASHMEMO_V1_AUTH_REGISTER_LIMIT: E2E_AUTH_RATE_LIMIT,
    CASHMEMO_V1_AUTH_VERIFICATION_RESEND_LIMIT: E2E_AUTH_RATE_LIMIT,
    CASHMEMO_V1_AUTH_LOGIN_LIMIT: E2E_AUTH_RATE_LIMIT,
    CASHMEMO_V1_AUTH_RESET_REQUEST_LIMIT: E2E_AUTH_RATE_LIMIT,
  };
}
