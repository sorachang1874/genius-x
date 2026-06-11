/**
 * Assistant control panel (Agent A) — M3. Shows the class's current stage and unlocks the next
 * one. The next stage + the role allowed to unlock it are read from the lesson config (no
 * hardcoded stage ids): assistant-unlock stages emit ASSISTANT_UNLOCK, teacher-unlock stages
 * emit TEACHER_UNLOCK — matching the engine's role gate.
 *
 * The assistant joins on the room code only (no studentId) and never sends HELLO — that would
 * register a phantom student and skew class-wide advance conditions. The current stage comes
 * from a read-only GET on connect (session context) and from STAGE_UNLOCK broadcasts.
 */
import { useState } from "react";
import { lesson001 } from "@genius-x/course-config";
import type { StageConfig, ClientMessage } from "@genius-x/contracts";
import { SessionProvider, useSession, type SessionProviderProps } from "../shared/session";

const STAGES = lesson001.stages;

/** scene.md: declared successors when present (the teacher's in-class scene choice),
 *  else the linear next — lesson-001 renders exactly one button, unchanged. */
function nextStages(currentStageId?: string): StageConfig[] {
  if (!currentStageId) return STAGES[0] ? [STAGES[0]] : [];
  const idx = STAGES.findIndex((s) => s.stageId === currentStageId);
  if (idx < 0) return [];
  const current = STAGES[idx]!;
  const ids = current.next ?? (idx + 1 < STAGES.length ? [STAGES[idx + 1]!.stageId] : []);
  return ids.map((id) => STAGES.find((s) => s.stageId === id)).filter((s): s is StageConfig => s !== undefined);
}

export function AssistantApp({ deps }: { deps?: SessionProviderProps["deps"] } = {}): React.JSX.Element {
  return (
    <SessionProvider role="assistant" {...(deps ? { deps } : {})}>
      <AssistantPanel />
    </SessionProvider>
  );
}

function AssistantPanel(): React.JSX.Element {
  const session = useSession();
  const [showForceAdvance, setShowForceAdvance] = useState(false);
  const [forceReason, setForceReason] = useState("");

  if (session.phase !== "live") {
    return <ConnectScreen />;
  }

  const current = STAGES.find((s) => s.stageId === session.currentStageId);
  // only offer "unlock next" once the class actually exists (a student has joined → currentStageId
  // is known). Before that, unlocking would target intro and be denied as "unknown session".
  const successors = nextStages(session.currentStageId);
  const next = successors[0]; // legacy single-successor flows (force-advance targets it)
  const assistantId = session.assistantId ?? "assistant-1";

  const unlock = (target: StageConfig): void => {
    if (target.unlock === "assistant") {
      session.send({ type: "ASSISTANT_UNLOCK", stageId: target.stageId, assistantId });
    } else {
      session.send({ type: "TEACHER_UNLOCK", stageId: target.stageId });
    }
  };

  const forceAdvance = (): void => {
    if (!next || !session.currentStageId) return;
    const trimmedReason = forceReason.trim();
    const msg: Extract<ClientMessage, { type: "FORCE_ADVANCE" }> = {
      type: "FORCE_ADVANCE",
      stageId: next.stageId,
      assistantId,
      expectedCurrentStageId: session.currentStageId,
    };
    if (trimmedReason) msg.reason = trimmedReason;
    session.send(msg);
    setShowForceAdvance(false);
    setForceReason("");
  };

  return (
    <div className="assistant-app">
      <header className="assistant-app__bar">
        <span>房间 {session.sessionId}</span>
        <span className={`conn conn--${session.connection}`}>{session.connection}</span>
      </header>

      <section className="assistant-app__now">
        <h2>当前环节</h2>
        <p className="assistant-app__stage">{current ? current.name : session.currentStageId ?? "（待开始）"}</p>
        <p className="assistant-app__global">全班状态：{session.global}</p>
      </section>

      <section className="assistant-app__controls">
        {next ? (
          <>
            {/* scene.md: one button per declared successor — the teacher's in-class scene
                choice. Linear lessons (lesson-001) render exactly one, unchanged. */}
            {successors.map((target) => (
              <button key={target.stageId} type="button" onClick={() => unlock(target)}>
                {successors.length > 1 ? `进入场景：${target.name}` : `解锁下一环节：${target.name}`}
                <small>（{target.unlock === "assistant" ? "助教" : "老师"}解锁）</small>
              </button>
            ))}

            {!showForceAdvance ? (
              <button
                type="button"
                className="assistant-app__force-btn"
                onClick={() => setShowForceAdvance(true)}
                title="跳过推进条件，直接解锁下一环节（会被审计记录）"
              >
                强制推进
              </button>
            ) : (
              <div className="assistant-app__force-confirm">
                <label>
                  推进原因（选填）
                  <input
                    type="text"
                    value={forceReason}
                    onChange={(e) => setForceReason(e.target.value)}
                    placeholder="例如：部分学生卡住，需要继续课程"
                    maxLength={100}
                  />
                </label>
                <div className="assistant-app__force-actions">
                  <button type="button" onClick={forceAdvance}>
                    确认强制推进
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowForceAdvance(false);
                      setForceReason("");
                    }}
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
          </>
        ) : session.currentStageId ? (
          <p>已经是最后一个环节啦 🎉</p>
        ) : (
          <p>等待第一位同学进入教室……</p>
        )}
      </section>
    </div>
  );
}

function ConnectScreen(): React.JSX.Element {
  const { join, phase, error } = useSession();
  const [roomCode, setRoomCode] = useState("");

  const onConnect = (e: React.FormEvent): void => {
    e.preventDefault();
    if (roomCode.trim()) void join(roomCode.trim());
  };

  return (
    <form className="assistant-connect" onSubmit={onConnect}>
      <h1>助教控制台</h1>
      <label>
        房间号
        <input value={roomCode} onChange={(e) => setRoomCode(e.target.value)} placeholder="课堂房间号" autoFocus />
      </label>
      <button type="submit" disabled={!roomCode.trim() || phase === "joining"}>连接课堂</button>
      {phase === "error" && error && <p className="assistant-connect__hint" role="status">连接失败：{error}</p>}
    </form>
  );
}
