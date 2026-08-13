export interface AuthenticatedSessionContext {
  readonly accountId: string;
  readonly sessionId: string;
}

export interface SessionAuthenticationPort {
  authenticate(requestHeaders: Headers): Promise<AuthenticatedSessionContext | null>;
  consumeReauthGrant(
    grantId: string,
    accountId: string,
    sessionId: string,
    requiredScope?: string,
  ): Promise<boolean>;
}
