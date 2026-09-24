"use client";

import { useEffect } from "react";
import { WifiOff } from "lucide-react";
import { toast } from "sonner";
import { useOnline } from "@/lib/use-online";

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

const INSTALL_SNOOZE_KEY = "cm-install-snoozed-at";
const INSTALL_SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

function snoozed(): boolean {
  try {
    return Date.now() - Number(localStorage.getItem(INSTALL_SNOOZE_KEY) ?? 0) < INSTALL_SNOOZE_MS;
  } catch {
    return false;
  }
}

function snooze() {
  try {
    localStorage.setItem(INSTALL_SNOOZE_KEY, String(Date.now()));
  } catch {
    // storage blocked (private mode): the prompt just shows again next visit
  }
}

/** Registers the service worker, offers updates and installation. Renders nothing. */
export function PwaRegister() {
  useEffect(() => {
    // Dev builds change on every save; a caching worker there only causes stale pages.
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;

    // The first install also changes the controller (clients.claim); only an accepted update should reload.
    const hadController = !!navigator.serviceWorker.controller;
    let reloading = false;
    const onControllerChange = () => {
      if (reloading || !hadController) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    const offerUpdate = (worker: ServiceWorker) =>
      toast("A new version of Cash Memo is ready", {
        duration: Infinity,
        action: { label: "Reload", onClick: () => worker.postMessage("skip-waiting") },
      });

    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        // Only an update when a worker already controls the page; the first install is silent.
        if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
        reg.addEventListener("updatefound", () => {
          const next = reg.installing;
          next?.addEventListener("statechange", () => {
            if (next.state === "installed" && navigator.serviceWorker.controller) offerUpdate(next);
          });
        });
      })
      .catch(() => {
        // Registration failing (e.g. blocked by the browser) just means no offline support.
      });

    const onInstallPrompt = (e: Event) => {
      e.preventDefault();
      if (snoozed()) return;
      const prompt = e as InstallPromptEvent;
      toast("Install Cash Memo for quick access from your home screen", {
        duration: 15_000,
        action: {
          label: "Install",
          onClick: () => void prompt.prompt(),
        },
        onDismiss: snooze,
        onAutoClose: snooze,
      });
    };
    window.addEventListener("beforeinstallprompt", onInstallPrompt);

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      window.removeEventListener("beforeinstallprompt", onInstallPrompt);
    };
  }, []);

  return null;
}

/** Slim notice while the device is offline; cached data stays readable underneath. */
export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div
      role="status"
      className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-foreground px-4 pt-[max(0.375rem,env(safe-area-inset-top))] pb-1.5 text-xs font-medium text-background"
    >
      <WifiOff className="size-3.5" aria-hidden />
      You&apos;re offline — showing saved data
    </div>
  );
}
