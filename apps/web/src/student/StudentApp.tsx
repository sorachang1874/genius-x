/**
 * Student client (Agent B) — M3. Room-code join → classroom, routed by the authoritative
 * `currentStageId` from the server. Stages 1–2 (intro → icebreak → shape) are live; later
 * stages (talent/birth/closure) show a standby placeholder until M4.
 *
 * Reconnect/resume is handled in the session context (HELLO → RESUME_STATE). A dropped socket
 * shows a gentle "reconnecting" hint, never an error to the child (PRD §0).
 */
import { useState } from "react";
import { SessionProvider, useSession } from "../shared/session";
import { Standby } from "./stages/Standby";
import { Intro } from "./stages/Intro";
import { Icebreak } from "./stages/Icebreak";
import { Shape } from "./stages/Shape";

export function StudentApp(): React.JSX.Element {
  return (
    <SessionProvider role="student">
      <StudentClassroom />
    </SessionProvider>
  );
}

function StudentClassroom(): React.JSX.Element {
  const session = useSession();

  if (session.phase === "idle" || session.phase === "error") {
    return <JoinScreen />;
  }
  if (session.phase === "joining") {
    return <Standby copy="正在进入教室……" />;
  }

  return (
    <div className="classroom">
      {session.connection === "disconnected" && (
        <div className="reconnect-hint" role="status">正在重新连接好朋友…… ✨</div>
      )}
      <StageView stageId={session.currentStageId} />
    </div>
  );
}

function StageView({ stageId }: { stageId?: string | undefined }): React.JSX.Element {
  switch (stageId) {
    case "icebreak":
      return <Icebreak stageId={stageId} />;
    case "shape":
      return <Shape stageId={stageId} />;
    case "intro":
    case undefined:
      return <Intro />;
    default:
      // talent / birth / closure → M4
      return <Standby copy="魔法还在继续，下一个惊喜马上来 ✨" />;
  }
}

function JoinScreen(): React.JSX.Element {
  const { join, phase, error } = useSession();
  const [roomCode, setRoomCode] = useState("");
  const [name, setName] = useState("");

  const onJoin = (e: React.FormEvent): void => {
    e.preventDefault();
    if (roomCode.trim()) void join(roomCode.trim(), name.trim() || undefined);
  };

  return (
    <form className="join-screen" onSubmit={onJoin}>
      <h1>魔法泥人 ✨</h1>
      <label>
        房间号
        <input value={roomCode} onChange={(e) => setRoomCode(e.target.value)} placeholder="老师给的房间号" autoFocus />
      </label>
      <label>
        我的名字（可选）
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="你的名字" />
      </label>
      <button type="submit" disabled={!roomCode.trim()}>进入教室</button>
      {phase === "error" && <p className="join-screen__hint" role="status">没找到教室，问问老师房间号对不对～</p>}
      {error && <p hidden>{error}</p>}
    </form>
  );
}
