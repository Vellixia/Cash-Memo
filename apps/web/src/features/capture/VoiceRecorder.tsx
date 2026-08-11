import { useRef, useState } from "react";

import type { AssistedCaptureApiPort, VoiceCaptureView } from "../../app/journal-api.js";
import { ProviderConsent, STT_CONSENT, TRANSCRIPT_CONSENT } from "../privacy/ProviderConsent.js";

export function VoiceRecorder({ api }: { readonly api: AssistedCaptureApiPort }) {
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [consent, setConsent] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [capture, setCapture] = useState<VoiceCaptureView | null>(null);
  const [state, setState] = useState<
    "idle" | "recording" | "ready" | "uploading" | "permission" | "error"
  >("idle");

  function stop(limit = false) {
    if (timer.current !== null) clearInterval(timer.current);
    timer.current = null;
    recorder.current?.stop();
    setState("ready");
    if (limit) setSeconds(60);
  }

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks.current = [];
      const next = new MediaRecorder(stream, { mimeType: "audio/webm" });
      next.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.current.push(event.data);
      };
      next.onstop = () => {
        setBlob(new Blob(chunks.current, { type: next.mimeType || "audio/webm" }));
        stream.getTracks().forEach((track) => track.stop());
      };
      next.onerror = () => {
        setState("error");
        stream.getTracks().forEach((track) => track.stop());
      };
      for (const track of stream.getTracks()) {
        track.addEventListener(
          "ended",
          () => {
            if (next.state === "recording") stop();
            setState("error");
          },
          { once: true },
        );
      }
      next.start();
      recorder.current = next;
      setSeconds(0);
      setState("recording");
      timer.current = setInterval(() => {
        setSeconds((value) => {
          if (value >= 59) {
            stop(true);
            return 60;
          }
          return value + 1;
        });
      }, 1000);
    } catch {
      setState("permission");
    }
  }

  async function upload() {
    if (blob === null) return;
    setState("uploading");
    try {
      const started =
        capture ??
        (await api.startVoiceCapture({
          aiConsent: TRANSCRIPT_CONSENT,
          captureStartedAt: new Date().toISOString(),
          captureTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          detectorLimitationDisclosed: true,
          sttConsent: STT_CONSENT,
        }));
      setCapture(started);
      const result = await api.uploadVoiceAudio(started.id, blob, crypto.randomUUID());
      setCapture(result);
      setState(
        result.state === "draft_review" || result.state === "correction_required"
          ? "ready"
          : "error",
      );
    } catch {
      setState("error");
    }
  }

  async function cancel() {
    if (capture !== null) await api.cancelVoiceCapture(capture.id, capture.revision);
    setBlob(null);
    setCapture(null);
    setSeconds(0);
    setState("idle");
  }

  return (
    <section data-testid="voice-recorder">
      <h3>Voice-assisted draft</h3>
      <ProviderConsent checked={consent} mode="voice" onChange={setConsent} />
      <p data-testid="recording-limit">Recording limit: 60 seconds.</p>
      <p aria-live="polite">
        {seconds} seconds elapsed · {60 - seconds} seconds remaining
      </p>
      <button
        disabled={!consent || state === "recording"}
        onClick={() => void start()}
        type="button"
      >
        Start recording
      </button>
      <button disabled={state !== "recording"} onClick={() => stop()} type="button">
        Stop and review recording
      </button>
      <button
        disabled={blob === null || state === "uploading"}
        onClick={() => void upload()}
        type="button"
      >
        Send this recording
      </button>
      <button
        disabled={blob === null && capture === null}
        onClick={() => void cancel()}
        type="button"
      >
        Cancel recording
      </button>
      {seconds === 60 ? (
        <p data-testid="recording-limit-reached">
          60-second limit reached. Recording retained for review.
        </p>
      ) : null}
      {state === "permission" ? (
        <p role="alert">Microphone permission denied. Manual capture remains available.</p>
      ) : null}
      {state === "uploading" ? <p>Transcribing and preparing a draft…</p> : null}
      {state === "error" ? (
        <p role="alert">
          {capture?.errorCode?.startsWith("STT") === true
            ? "Transcription unavailable."
            : capture?.errorCode?.startsWith("AI") === true
              ? "AI extraction unavailable."
              : "Voice assistance unavailable."}{" "}
          Retry this recording or use manual capture.
        </p>
      ) : null}
      {capture?.draftId === null || capture === null ? null : (
        <p>Draft ready for review. It is not yet a Money Memo.</p>
      )}
    </section>
  );
}
