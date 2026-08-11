import type { TemporaryAudioService } from "../assisted-capture/temporary-audio.service.js";

export interface AudioSweepResult {
  readonly cleanupFailures: number;
  readonly removed: number;
}

export class AudioSweeper {
  private readonly audio: TemporaryAudioService;
  private readonly alert: (code: "AUDIO_DELETE_FAILED") => void;
  private readonly now: () => Date;
  private timer: NodeJS.Timeout | null = null;

  constructor(options: {
    readonly alert?: (code: "AUDIO_DELETE_FAILED") => void;
    readonly audio: TemporaryAudioService;
    readonly now?: () => Date;
  }) {
    this.alert = options.alert ?? (() => undefined);
    this.audio = options.audio;
    this.now = options.now ?? (() => new Date());
  }

  async runOnce(): Promise<AudioSweepResult> {
    let removed = 0;
    let cleanupFailures = 0;
    for (const entry of this.audio.entries()) {
      if (entry.expiresAt > this.now().getTime()) continue;
      try {
        await this.audio.delete(entry.accountId, entry.audioId, "expired");
        removed += 1;
      } catch {
        cleanupFailures += 1;
        this.alert("AUDIO_DELETE_FAILED");
      }
    }
    return Object.freeze({ cleanupFailures, removed });
  }

  startupCleanup(): Promise<AudioSweepResult> {
    return this.runOnce();
  }

  start(): () => void {
    if (this.timer === null) {
      this.timer = setInterval(() => {
        void this.runOnce();
      }, 60_000);
      this.timer.unref();
    }
    return () => {
      this.stop();
    };
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  async terminate(): Promise<void> {
    this.stop();
    try {
      await this.audio.terminate();
    } catch {
      this.alert("AUDIO_DELETE_FAILED");
      throw new Error("AUDIO_DELETE_FAILED");
    }
  }

  installTerminationHook(): () => void {
    const handler = () => {
      void this.terminate();
    };
    process.once("SIGTERM", handler);
    process.once("SIGINT", handler);
    return () => {
      process.off("SIGTERM", handler);
      process.off("SIGINT", handler);
    };
  }
}
