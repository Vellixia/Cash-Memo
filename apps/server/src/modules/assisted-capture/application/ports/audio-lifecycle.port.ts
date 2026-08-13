export interface ExpiringAudioEntry {
  readonly accountId: string;
  readonly audioId: string;
  readonly captureId: string;
  readonly expiresAt: number;
}

export interface AudioLifecyclePort {
  delete(accountId: string, audioId: string, reason: "expired"): Promise<void>;
  entries(): readonly ExpiringAudioEntry[];
  terminate(): Promise<void>;
}
