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
import { Talent } from "./stages/Talent";
import { Birth } from "./stages/Birth";
import { Closure } from "./stages/Closure";

export function StudentApp(): React.JSX.Element {
  return (
    <SessionProvider role="student">
      <StudentClassroom />
    </SessionProvider>
  );
}

function StudentClassroom(): React.JSX.Element {
  const session = useSession();

  // JoinScreen stays mounted through "joining" so the typed room code survives a rejected
  // join (unmount/remount would wipe the child's input on every 404/403/network failure).
  if (session.phase === "idle" || session.phase === "error" || session.phase === "joining") {
    return <JoinScreen />;
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
  // Presentation mapping only: each stage has a bespoke child experience (a voice break-the-ice
  // vs a doodle canvas are different UIs), so the FRONTEND picks a component per stage id. This is
  // not engine logic — no stage semantics/advance rules live here (the server stays config-driven).
  // Unmapped stages fall through to a safe standby placeholder (talent/birth/closure → M4).
  switch (stageId) {
    case "icebreak":
      return <Icebreak stageId={stageId} />;
    case "shape":
      return <Shape stageId={stageId} />;
    case "talent":
      return <Talent stageId={stageId} />;
    case "birth":
      return <Birth stageId={stageId} />;
    case "closure":
      return <Closure stageId={stageId} />;
    case "intro":
    case undefined:
      return <Intro />;
    default:
      return <Standby copy="魔法还在继续，下一个惊喜马上来 ✨" />;
  }
}

/** Exported for tests (banned-wording scan + warm-failure pinning). */
export function JoinScreen(): React.JSX.Element {
  const { join, phase, error } = useSession();
  const joining = phase === "joining";
  // Phase 1: the child's persistent identity arrives via the enrollment link/QR
  // (?studentId=...) — never typed in. ?room= optionally prefills the room code.
  // The name is owned by the enrolled profile now (the server ignores a typed name).
  const params = new URLSearchParams(window.location.search);
  const studentId = params.get("studentId") ?? "";
  const [roomCode, setRoomCode] = useState(params.get("room") ?? "");

  if (!studentId) {
    // Warm non-failure (frozen child-facing reconciliation): no error state, just guidance.
    return (
      <div className="join-screen">
        <h1>魔法泥人 ✨</h1>
        <p role="status">请用老师发给你的专属链接或二维码进入教室哦～</p>
      </div>
    );
  }

  const onJoin = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!joining && roomCode.trim()) void join(roomCode.trim(), undefined, studentId);
  };

  return (
    <form className="join-screen" onSubmit={onJoin}>
      <h1>魔法泥人 ✨</h1>
      <label>
        房间号
        <input value={roomCode} onChange={(e) => setRoomCode(e.target.value)} placeholder="老师给的房间号" autoFocus disabled={joining} />
      </label>
      <button type="submit" disabled={joining || !roomCode.trim()}>
        {joining ? "正在进入教室……" : "进入教室"}
      </button>
      {/* Any rejection (room/identity/tenant) renders warm — the real code stays operator-side. */}
      {phase === "error" && <p className="join-screen__hint" role="status">还没进去呢，请老师来帮帮忙吧～</p>}
      {error && <p hidden>{error}</p>}
    </form>
  );
}
