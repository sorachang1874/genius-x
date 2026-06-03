/**
 * Shape stage — A-line "涂鸦变身" (M3). Minimal native-canvas freehand doodle → "变身" sends an
 * INTERACT(doodle) → latency dressed as thinking (8–15s copy) → 3 candidate images → the child
 * selects one, which becomes their friend (STAGE_COMPLETE selection avatarUrl).
 *
 * Per the design, the doodle/canvas is **interim** (DF-M3-6): minimal freehand, no library.
 * The doodleRef is a placeholder (DF-M3-2) — no raw bytes cross the wire (privacy contract).
 * Candidate images (pre-selection) are transient; a refresh re-shows the doodle step.
 */
import { useMemo, useRef, useState } from "react";
import type { StageId } from "@genius-x/contracts";
import { useSession } from "../../shared/session";
import { Thinking } from "../../shared/thinking";
import { createAiOutputPlayer, type AiOutputPlayer } from "../../shared/ai-output";

export interface ShapeProps {
  stageId: StageId;
  /** A-line variant id from the lesson config (shape → "drawing"). */
  variantId?: string;
  player?: AiOutputPlayer;
}

function newDoodleRef(): string {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Math.random().toString(36).slice(2)}`;
  return `placeholder-doodle://${id}`;
}

export function Shape({ stageId, variantId = "drawing", player }: ShapeProps): React.JSX.Element {
  const { pendingInteractionId, lastOutput, you, interact, complete } = useSession();
  const aiPlayer = useMemo(() => player ?? createAiOutputPlayer(), [player]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  const chosenAvatar = you.outputs.avatarUrl;
  const thinking = pendingInteractionId !== undefined;
  const candidates = lastOutput ? aiPlayer.imageUrls(lastOutput.output) : [];

  // --- minimal freehand drawing (interim, DF-M3-6) ---
  const point = (e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const startDraw = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    drawing.current = true;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = point(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };
  const moveDraw = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!drawing.current) return;
    setHasDrawn(true);
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = point(e);
    ctx.lineTo(x, y);
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#5b3fff";
    ctx.stroke();
  };
  const endDraw = (): void => {
    drawing.current = false;
  };

  const transform = (): void => {
    interact(stageId, { kind: "doodle", doodleRef: newDoodleRef() }, variantId);
  };
  const pick = (avatarUrl: string): void => {
    complete(stageId, { kind: "selection", output: "avatarUrl", value: avatarUrl });
  };

  // 1) already chosen → the friend is born
  if (chosenAvatar) {
    return (
      <div className="stage stage--shape">
        <h2 className="stage__title">这就是我的好朋友！</h2>
        <img className="avatar avatar--chosen" src={String(chosenAvatar)} alt="我的好朋友" />
      </div>
    );
  }

  // 2) transforming → thinking
  if (thinking) {
    return (
      <div className="stage stage--shape">
        <Thinking copy="正在把你的涂鸦变成好朋友……大约十几秒哦 ✨" />
      </div>
    );
  }

  // 3) candidates ready → choose one
  if (candidates.length > 0) {
    return (
      <div className="stage stage--shape">
        <h2 className="stage__title">选一个你最喜欢的样子吧！</h2>
        <div className="candidates">
          {candidates.map((url, i) => (
            <CandidateTile key={url} url={url} index={i} onPick={() => pick(url)} />
          ))}
        </div>
      </div>
    );
  }

  // 4) doodle step
  return (
    <div className="stage stage--shape">
      <h2 className="stage__title">画出你的好朋友吧！</h2>
      <canvas
        ref={canvasRef}
        width={320}
        height={320}
        className="doodle-canvas"
        aria-label="涂鸦画板"
        onPointerDown={startDraw}
        onPointerMove={moveDraw}
        onPointerUp={endDraw}
        onPointerLeave={endDraw}
      />
      <button type="button" className="btn btn--transform" disabled={!hasDrawn} onClick={transform}>
        ✨ 变身！
      </button>
    </div>
  );
}

function CandidateTile({ url, index, onPick }: { url: string; index: number; onPick: () => void }): React.JSX.Element {
  const [broken, setBroken] = useState(false);
  return (
    <button type="button" className="candidate" onClick={onPick} aria-label={`候选 ${index + 1}`}>
      {broken ? (
        <span className="candidate__placeholder" aria-hidden="true">🪄</span>
      ) : (
        <img src={url} alt={`候选 ${index + 1}`} onError={() => setBroken(true)} />
      )}
    </button>
  );
}
