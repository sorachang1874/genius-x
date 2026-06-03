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
import type { StageConfig } from "@genius-x/contracts";
import { SessionProvider, useSession } from "../shared/session";

const STAGES = lesson001.stages;

function nextStage(currentStageId?: string): StageConfig | undefined {
  if (!currentStageId) return STAGES[0];
  const idx = STAGES.findIndex((s) => s.stageId === currentStageId);
  return idx >= 0 ? STAGES[idx + 1] : undefined;
}

export function AssistantApp(): React.JSX.Element {
  return (
    <SessionProvider role="assistant">
      <AssistantPanel />
    </SessionProvider>
  );
}

function AssistantPanel(): React.JSX.Element {
  const session = useSession();

  if (session.phase !== "live") {
    return <ConnectScreen />;
  }

  const current = STAGES.find((s) => s.stageId === session.currentStageId);
  const next = nextStage(session.currentStageId);
  const assistantId = session.assistantId ?? "assistant-1";

  const unlock = (): void => {
    if (!next) return;
    if (next.unlock === "assistant") {
      session.send({ type: "ASSISTANT_UNLOCK", stageId: next.stageId, assistantId });
    } else {
      session.send({ type: "TEACHER_UNLOCK", stageId: next.stageId });
    }
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
          <button type="button" onClick={unlock}>
            解锁下一环节：{next.name}
            <small>（{next.unlock === "assistant" ? "助教" : "老师"}解锁）</small>
          </button>
        ) : (
          <p>已经是最后一个环节啦 🎉</p>
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
