/**
 * ClientAiOutput renderer port (M3, the "C" swap-ready abstraction). Given a `ClientAiOutput`
 * the player **plays `audioUrl` if present, else speaks `text`** via the Web Speech API, and
 * exposes `imageUrls` for the stage to render.
 *
 * Non-failure path (PRD §0 — the child never sees an error): on any audio load/play failure
 * the player silently falls back to speaking the text. When real TTS/image providers land
 * (DF-M3-1 / M6) the placeholders move server-side and this port is unchanged.
 */
import type { ClientAiOutput } from "@genius-x/contracts";

/** Minimal audio surface we depend on (real impl: HTMLAudioElement); injectable for tests. */
export interface AudioLike {
  play(): Promise<void>;
}

export interface AiOutputPlayer {
  /** Play audio-or-speak. Resolves once playback is *started* (or speech queued); never rejects. */
  play(output: ClientAiOutput): Promise<void>;
  /** Image candidates for a stage to render (empty if none). */
  imageUrls(output: ClientAiOutput): string[];
}

export interface AiOutputPlayerDeps {
  makeAudio?: (url: string) => AudioLike;
  speak?: (text: string) => void;
}

function defaultSpeak(text: string): void {
  try {
    const synth = globalThis.speechSynthesis;
    if (!synth || typeof SpeechSynthesisUtterance === "undefined") return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    synth.speak(utterance);
  } catch {
    // speech is best-effort decoration, never a failure surface
  }
}

export function createAiOutputPlayer(deps: AiOutputPlayerDeps = {}): AiOutputPlayer {
  const makeAudio = deps.makeAudio ?? ((url: string) => new Audio(url));
  const speak = deps.speak ?? defaultSpeak;

  return {
    async play(output: ClientAiOutput): Promise<void> {
      if (output.audioUrl) {
        try {
          await makeAudio(output.audioUrl).play();
          return;
        } catch {
          // audio failed to load/play — fall through to spoken text; the child sees no error
        }
      }
      if (output.text) speak(output.text);
    },
    imageUrls: (output: ClientAiOutput): string[] => output.imageUrls ?? [],
  };
}
