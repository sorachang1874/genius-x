/**
 * Birth stage — 诞生礼 (M4b). The server pre-generates the 专属台词; this screen waits for it
 * (AI_READY-gated, never a blank), shows ONE big play button → `playPrepared` replays the stored
 * speech instantly → the 「伙伴出生证」 appears, assembled from authoritative `you`. The play is
 * replayable. STAGE_COMPLETE{done} is sent once after the first play (the birth→closure gate).
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

  // resolve the ready prepared id: from a live AI_READY for this stage, else from authoritative
  // `you.prepared` (so a reconnect mid-birth restores the play button).
  const liveReady = readyPrepared?.stageId === stageId ? readyPrepared.preparedId : undefined;
  const fromYou = Object.entries(you.prepared).find(([, p]) => p.ready && p.stageId === stageId)?.[0];
  const preparedId = liveReady ?? fromYou;

  const played = !!preparedId && lastOutput?.interactionId === preparedId;
  const speechText = played ? lastOutput?.output.text : undefined;

  // play the stored speech once when it arrives, and finish the stage once.
  useEffect(() => {
    if (played && lastOutput && lastOutput.interactionId !== playedRef.current) {
      playedRef.current = lastOutput.interactionId;
      void aiPlayer.play(lastOutput.output);
      if (!completedRef.current) {
        completedRef.current = true;
        complete(stageId, { kind: "done" });
      }
    }
  }, [played, lastOutput, aiPlayer, complete, stageId]);

  if (!preparedId) {
    return (
      <div className="stage stage--birth">
        <Thinking copy="正在准备一个只属于你的惊喜…… ✨" />
      </div>
    );
  }

  return (
    <div className="stage stage--birth">
      {played ? (
        <>
          <Certificate you={you} speechText={speechText} />
          <button type="button" className="btn" onClick={() => playPrepared(stageId, preparedId)}>🔁 再听一次</button>
        </>
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}
