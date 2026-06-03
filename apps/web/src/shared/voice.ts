/**
 * VoiceCapture port (M3). Real hold-to-talk UX over `getUserMedia` (so the child sees a live
 * permission prompt + recording indicator), but for M3 it yields a **placeholder `audioRef`**
 * — no raw audio bytes cross the wire (data-and-privacy contract); real upload→ref is DF-M3-2.
 *
 * Non-failure path: if the mic is denied or unavailable, capture degrades gracefully —
 * `stop()` STILL returns a ref so the INTERACT is sent and the child gets a positive output
 * (PRD §0). The denial is surfaced to operators via `lastError`, never as a child-facing error.
 */
import { useCallback, useRef, useState } from "react";
import type { AudioRef } from "@genius-x/contracts";

export interface VoiceCaptureDeps {
  /** Defaults to navigator.mediaDevices.getUserMedia. */
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  /** Placeholder ref minter (DF-M3-2). */
  mkRef?: () => AudioRef;
  /** Operator-visible degradation sink (mic denial is invisible to the child, NOT to operators). */
  onDegraded?: (info: { reason: string }) => void;
}

function defaultOnDegraded(info: { reason: string }): void {
  // eslint-disable-next-line no-console
  console.warn("[client-degraded] voice", info.reason);
}

export interface VoiceCapture {
  /** Begin capture. Never throws; on mic denial it records the reason and degrades. */
  start(): Promise<void>;
  /** End capture, release the mic, and return a (placeholder) audioRef. Never throws. */
  stop(): Promise<AudioRef>;
  /** True while a stream is open. */
  readonly active: boolean;
  /** Operator-visible mic error (e.g. NotAllowedError); never shown to the child. */
  readonly lastError: string | null;
}

function defaultMkRef(): AudioRef {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Math.random().toString(36).slice(2)}`;
  return `placeholder-audio://${id}`;
}

/** Imperative capture controller (used by the hook; unit-testable without React). */
export function createVoiceCapture(deps: VoiceCaptureDeps = {}): VoiceCapture {
  const mkRef = deps.mkRef ?? defaultMkRef;
  const onDegraded = deps.onDegraded ?? defaultOnDegraded;
  const getUserMedia =
    deps.getUserMedia ??
    ((constraints: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(constraints));

  let stream: MediaStream | null = null;
  let lastError: string | null = null;

  const controller: VoiceCapture = {
    async start(): Promise<void> {
      lastError = null;
      try {
        stream = await getUserMedia({ audio: true });
      } catch (err) {
        // degrade: no stream, but capture still "works" — stop() returns a ref anyway. Invisible
        // to the child (still a positive output), surfaced to operators (degradation principle).
        stream = null;
        lastError = err instanceof Error ? err.name || err.message : String(err);
        onDegraded({ reason: `mic_unavailable:${lastError}` });
      }
    },
    async stop(): Promise<AudioRef> {
      if (stream) {
        for (const track of stream.getTracks()) track.stop();
        stream = null;
      }
      return mkRef();
    },
    get active(): boolean {
      return stream !== null;
    },
    get lastError(): string | null {
      return lastError;
    },
  };
  return controller;
}

export interface UseVoiceCapture {
  recording: boolean;
  /** Mic was denied/unavailable on the last start (operator signal; the UX still proceeds). */
  micDenied: boolean;
  begin(): Promise<void>;
  /** Ends capture and returns the audioRef to send in an INTERACT. */
  end(): Promise<AudioRef>;
}

/** React wrapper around `createVoiceCapture` for the Icebreak hold-to-talk control. */
export function useVoiceCapture(deps?: VoiceCaptureDeps): UseVoiceCapture {
  const ref = useRef<VoiceCapture | null>(null);
  const [recording, setRecording] = useState(false);
  const [micDenied, setMicDenied] = useState(false);

  const begin = useCallback(async (): Promise<void> => {
    const capture = createVoiceCapture(deps);
    ref.current = capture;
    await capture.start();
    setMicDenied(capture.lastError !== null);
    setRecording(true);
  }, [deps]);

  const end = useCallback(async (): Promise<AudioRef> => {
    const capture = ref.current;
    setRecording(false);
    if (!capture) return createVoiceCapture(deps).stop();
    const audioRef = await capture.stop();
    ref.current = null;
    return audioRef;
  }, [deps]);

  return { recording, micDenied, begin, end };
}
