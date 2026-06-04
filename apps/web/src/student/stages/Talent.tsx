/**
 * Talent stage — 才艺互动 (M4b). The child taps a talent card → the friend replies (often with a
 * "反问"); the child can answer by voice. Each interaction is invisibly mined for memories on the
 * server. Options come from the lesson's `multimodal_talent` config (ids → friendly cards here);
 * progress is derived from `interactionCounts` vs the config `minInteractions` (no hardcoded number).
 * No AI/Prompt/LLM wording; every tap → a positive output; latency = thinking.
 */
import { useEffect, useMemo, useRef } from "react";
import { lesson001 } from "@genius-x/course-config";
import type { StageId } from "@genius-x/contracts";
import { useSession } from "../../shared/session";
import { Thinking } from "../../shared/thinking";
import { createAiOutputPlayer, type AiOutputPlayer } from "../../shared/ai-output";
import { useVoiceCapture, type VoiceCaptureDeps } from "../../shared/voice";

export interface TalentProps {
  stageId: StageId;
  player?: AiOutputPlayer;
  voiceDeps?: VoiceCaptureDeps;
}

/** Presentation-only mapping of config option ids → child-safe cards. */
const CARD: Record<string, { icon: string; label: string }> = {
  sing: { icon: "🎤", label: "唱首歌" },
  story: { icon: "📖", label: "讲故事" },
  question: { icon: "❓", label: "问个问题" },
  draw: { icon: "🎨", label: "画幅画" },
};

export function Talent({ stageId, player, voiceDeps }: TalentProps): React.JSX.Element {
  const { pendingInteractionId, lastOutput, you, interact } = useSession();
  const aiPlayer = useMemo(() => player ?? createAiOutputPlayer(), [player]);
  const voice = useVoiceCapture(voiceDeps);
  const playedRef = useRef<string | null>(null);
  const pressed = useRef(false);

  useEffect(() => {
    if (lastOutput && lastOutput.interactionId !== playedRef.current) {
      playedRef.current = lastOutput.interactionId;
      void aiPlayer.play(lastOutput.output);
    }
  }, [lastOutput, aiPlayer]);

  const stage = lesson001.stages.find((s) => s.stageId === stageId);
  const interaction = stage?.interaction;
  const options = interaction?.type === "multimodal_talent" ? interaction.options : [];
  const need = interaction?.type === "multimodal_talent" ? interaction.minInteractions : 0;
  const done = you.interactionCounts[stageId] ?? 0;
  const remaining = Math.max(0, need - done);
  const thinking = pendingInteractionId !== undefined;

  const pick = (option: string): void => {
    interact(stageId, { kind: "talentOption", option });
  };
  const onPressStart = (): void => {
    if (pressed.current) return;
    pressed.current = true;
    void voice.begin();
  };
  const onPressEnd = (): void => {
    if (!pressed.current) return;
    pressed.current = false;
    void voice.end().then((audioRef) => interact(stageId, { kind: "talentAnswer", audioRef }));
  };

  return (
    <div className="stage stage--talent">
      <h2 className="stage__title">和好朋友一起玩才艺吧！</h2>
      <p className="stage__copy">{remaining > 0 ? `再玩 ${remaining} 个就完成啦` : "玩得真棒，可以继续，也可以等老师 ✨"}</p>

      {thinking ? (
        <Thinking copy="好朋友正在给你表演……" />
      ) : (
        lastOutput?.output.text && <p className="bubble bubble--friend" data-testid="friend-reply">{lastOutput.output.text}</p>
      )}

      <div className="talent-cards">
        {options.map((opt) => {
          const card = CARD[opt] ?? { icon: "✨", label: opt };
          return (
            <button key={opt} type="button" className="talent-card" disabled={thinking} onClick={() => pick(opt)}>
              <span aria-hidden="true">{card.icon}</span>
              {card.label}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className={`mic ${voice.recording ? "mic--on" : ""}`}
        aria-pressed={voice.recording}
        disabled={thinking}
        onPointerDown={onPressStart}
        onPointerUp={onPressEnd}
        onPointerLeave={onPressEnd}
      >
        {voice.recording ? "🎙️ 松开就说完啦" : "🎤 按住，回答好朋友"}
      </button>
    </div>
  );
}
