"use client";

import { useSyncExternalStore } from "react";

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

export type InstallState = {
  /** The browser offered an install prompt (Chrome/Edge/Android) and the app isn't installed. */
  canInstall: boolean;
  /** Already running as an installed app. */
  installed: boolean;
  /** iOS Safari: no prompt API; users install via Share → Add to Home Screen. */
  iosHint: boolean;
};

const SERVER: InstallState = { canInstall: false, installed: false, iosHint: false };

let deferred: InstallPromptEvent | null = null;
let snapshot: InstallState = SERVER;
const listeners = new Set<() => void>();

function compute(): InstallState {
  const installed =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return { canInstall: !installed && deferred !== null, installed, iosHint: ios && !installed };
}

function refresh() {
  snapshot = compute();
  listeners.forEach((l) => l());
}

// Registered at module load so a prompt fired before React hydrates isn't missed.
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // no browser mini-infobar; the app shows its own quiet "Install app" entry
    deferred = e as InstallPromptEvent;
    refresh();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    refresh();
  });
  snapshot = compute();
}

/** Install availability for an "Install app" button; `install()` resolves true if the user accepted. */
export function useInstall(): InstallState & { install: () => Promise<boolean> } {
  const state = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => snapshot,
    () => SERVER,
  );
  return {
    ...state,
    install: async () => {
      if (!deferred) return false;
      const prompt = deferred;
      deferred = null; // a prompt event can only be used once
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      refresh();
      return outcome === "accepted";
    },
  };
}
