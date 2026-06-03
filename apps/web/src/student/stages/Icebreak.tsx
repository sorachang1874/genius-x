/**
 * Icebreak stage (M3) — hold-to-talk voice break-the-ice. Press to record, release to send an
 * INTERACT(voice); latency shows the "thinking" magic; the friend's reply is played
 * audio-or-spoken (ai-output port). Every press yields a positive output — mic denial still
 * sends the interaction (voice port degrades gracefully). No AI/Prompt/LLM wording.
 */
import { useEffect, useMemo, useRef } from "react";
import type { StageId } from "@genius-x/contracts";
import { useSession } from "../../shared/session";
import { Thinking } from "../../shared/thinking";
import { createAiOutputPlayer, type AiOutputPlayer } from "../../shared/ai-output";
import { useVoiceCapture, type VoiceCaptureDeps } from "../../shared/voice";

export interface IcebreakProps {
  stageId: StageId;
  /** Injectable for tests. */
  player?: AiOutputPlayer;
  voiceDeps?: VoiceCaptureDeps;
}

export function Icebreak({ stageId, player, voiceDeps }: IcebreakProps): React.JSX.Element {
  const { pendingInteractionId, lastOutput, interact } = useSession();
  const aiPlayer = useMemo(() => player ?? createAiOutputPlayer(), [player]);
  const voice = useVoiceCapture(voiceDeps);
  const playedRef = useRef<string | null>(null);
  // synchronous press latch — pointerUp AND pointerLeave both call onPressEnd; without this
  // a quick release could fire two voice.end()s (recording state updates async) → double INTERACT.
  const pressed = useRef(false);

  // play the friend's reply exactly once per interaction (audio-or-spoken)
  useEffect(() => {
    if (lastOutput && lastOutput.interactionId !== playedRef.current) {
      playedRef.current = lastOutput.interactionId;
      void aiPlayer.play(lastOutput.output);
    }
  }, [lastOutput, aiPlayer]);

  const thinking = pendingInteractionId !== undefined;

  const onPressStart = (): void => {
    if (pressed.current) return;
    pressed.current = true;
    void voice.begin();
  };
  const onPressEnd = (): void => {
    if (!pressed.current) return;
    pressed.current = false;
    void voice.end().then((audioRef) => {
      interact(stageId, { kind: "voice", audioRef });
    });
  };

  return (
    <div className="stage stage--icebreak">
      <h2 className="stage__title">和好朋友说说话吧！</h2>

      {thinking ? (
        <Thinking copy="好朋友正在认真听你说……" />
      ) : (
        lastOutput?.output.text && (
          <p className="bubble bubble--friend" data-testid="friend-reply">{lastOutput.output.text}</p>
        )
      )}

      <button
        type="button"
        className={`mic ${voice.recording ? "mic--on" : ""}`}
        aria-pressed={voice.recording}
        disabled={thinking}
        onPointerDown={onPressStart}
        onPointerUp={onPressEnd}
        onPointerLeave={onPressEnd}
      >
        {voice.recording ? "🎙️ 松开就说完啦" : "🎤 按住，和我说话"}
      </button>
    </div>
  );
}
