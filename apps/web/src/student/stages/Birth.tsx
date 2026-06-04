/**
 * Birth stage — 诞生礼 (M4b). The server pre-generates the 专属台词; this screen waits for it
 * (AI_READY-gated, never blank), shows ONE big play button → `playPrepared` replays the stored
 * speech instantly → the 「伙伴出生证」 appears, assembled from authoritative `you`.
 *
 * Render-from-authoritative-state: "played" comes from `you.stageStatus[stageId] === "completed"`
 * (survives a reconnect) and the speech from `you.prepared[preparedId].output`; the transient
 * AI_OUTPUT only drives the first auto-play. STAGE_COMPLETE{done} is sent once, guarded on the
 * authoritative status. Replay plays the stored output directly (no round-trip).
 */
import { useEffect, useMemo, useRef } from "react";
import type { StageId } from "@genius-x/contracts";
import { useSession } from "../../shared/session";
import { Thinking } from "../../shared/thinking";
import { Certificate } from "../Certificate";
import { createAiOutputPlayer, type AiOutputPlayer } from "../../shared/ai-output";

export interface BirthProps {
  stageId: StageId;
  player?: AiOutputPlayer;
}

export function Birth({ stageId, player }: BirthProps): React.JSX.Element {
  const { readyPrepared, lastOutput, you, pendingInteractionId, playPrepared, complete } = useSession();
  const aiPlayer = useMemo(() => player ?? createAiOutputPlayer(), [player]);
  const playedRef = useRef<string | null>(null);
  const completedRef = useRef(false);

  // ready prepared id: a live AI_READY for this stage, else an authoritative ready entry in `you`.
  const liveReady = readyPrepared?.stageId === stageId ? readyPrepared.preparedId : undefined;
  const fromYou = Object.entries(you.prepared).find(([, p]) => p.ready && p.stageId === stageId)?.[0];
  const preparedId = liveReady ?? fromYou;

  // authoritative speech (survives reconnect) with the live AI_OUTPUT as the first-arrival source.
  const authOutput = preparedId ? you.prepared[preparedId]?.output : undefined;
  const liveOutput = preparedId && lastOutput?.interactionId === preparedId ? lastOutput.output : undefined;
  const speech = liveOutput ?? (authOutput && (authOutput.text || authOutput.audioUrl) ? authOutput : undefined);
  const completedHere = you.stageStatus[stageId] === "completed";
  const played = completedHere || !!liveOutput;

  // auto-play once when the live speech first arrives; finish the stage once (authoritative-guarded).
  useEffect(() => {
    if (liveOutput && lastOutput && lastOutput.interactionId !== playedRef.current) {
      playedRef.current = lastOutput.interactionId;
      void aiPlayer.play(liveOutput);
    }
    if (played && !completedHere && !completedRef.current) {
      completedRef.current = true;
      complete(stageId, { kind: "done" });
    }
  }, [liveOutput, lastOutput, played, completedHere, aiPlayer, complete, stageId]);

  if (!preparedId) {
    return (
      <div className="stage stage--birth">
        <Thinking copy="正在准备一个只属于你的惊喜…… ✨" />
      </div>
    );
  }

  if (played) {
    return (
      <div className="stage stage--birth">
        <Certificate you={you} speechText={speech?.text} />
        <button type="button" className="btn" disabled={!speech} onClick={() => speech && void aiPlayer.play(speech)}>🔁 再听一次</button>
      </div>
    );
  }

  return (
    <div className="stage stage--birth">
      <h2 className="stage__title">按下按钮，听听你的好朋友想对你说什么！</h2>
      <button
        type="button"
        className="btn btn--play"
        data-testid="play-prepared"
        disabled={pendingInteractionId !== undefined}
        onClick={() => playPrepared(stageId, preparedId)}
      >
        🎉 播放专属语音
      </button>
    </div>
  );
}
