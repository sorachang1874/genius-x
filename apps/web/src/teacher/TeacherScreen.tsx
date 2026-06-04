/**
 * Teacher / projection screen — 诞生礼大屏 (M4b, thin per DF-M4-4). Joins on the room code (a
 * control surface, like the assistant), shows the class roster with per-child readiness, lets the
 * teacher project a child's 伙伴出生证 to the big screen (`REQUEST_PROJECTION`), and renders +
 * plays the projected child's certificate on `PROJECT`.
 *
 * Projection is authorized only for a registered assistant id (`requestedBy ∈ session.assistants`);
 * in production that needs assistant registration on join (DF-M4-7 / DF-M3-8).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ClassSession, StudentRuntimeState } from "@genius-x/contracts";
import { SessionProvider, useSession } from "../shared/session";
import { Certificate } from "../student/Certificate";
import { createAiOutputPlayer } from "../shared/ai-output";
import { fetchSessionState, serverBaseUrl } from "../shared/socket";

export function TeacherScreen(): React.JSX.Element {
  return (
    <SessionProvider role="assistant">
      <TeacherPanel />
    </SessionProvider>
  );
}

function readyForCurrentStage(student: StudentRuntimeState, stageId?: string): boolean {
  return Object.values(student.prepared).some((p) => p.ready && p.stageId === stageId);
}

function TeacherPanel(): React.JSX.Element {
  const session = useSession();
  const player = useMemo(() => createAiOutputPlayer(), []);
  const [roster, setRoster] = useState<ClassSession | null>(null);

  const refresh = useCallback(async () => {
    if (session.sessionId) setRoster(await fetchSessionState(serverBaseUrl(), session.sessionId));
  }, [session.sessionId]);

  // refresh the roster on connect and whenever a projection lands (state may have advanced).
  useEffect(() => {
    void refresh();
  }, [refresh, session.projected, session.currentStageId]);

  // poll while live: birth pre-generation readiness is broadcast only to the student room, so the
  // big screen wouldn't otherwise learn when a child becomes projectable (DF-M4-4 thin version).
  useEffect(() => {
    if (session.phase !== "live") return;
    const id = setInterval(() => void refresh(), 4000);
    return () => clearInterval(id);
  }, [session.phase, refresh]);

  // play the projected child's speech on the big screen.
  useEffect(() => {
    if (session.projected) void player.play(session.projected.output);
  }, [session.projected, player]);

  if (session.phase !== "live") return <ConnectScreen />;

  const assistantId = session.assistantId ?? "assistant-1";
  const students = roster?.students ?? {};
  const projectedStudent = session.projected ? students[session.projected.studentId] : undefined;

  return (
    <div className="teacher-screen">
      <header className="teacher-screen__bar">
        <span>大屏 · 房间 {session.sessionId}</span>
        <button type="button" onClick={() => void refresh()}>刷新</button>
      </header>

      {session.projected && projectedStudent ? (
        <section className="teacher-screen__stage">
          <Certificate you={projectedStudent} speechText={session.projected.output.text} />
        </section>
      ) : (
        <p className="teacher-screen__hint">点一个小朋友，把 TA 的好朋友投到大屏上 ✨</p>
      )}

      <section className="teacher-screen__roster">
        {Object.entries(students).map(([id, st]) => {
          const ready = readyForCurrentStage(st, session.currentStageId);
          return (
            <button
              key={id}
              type="button"
              className={`roster-item ${ready ? "roster-item--ready" : ""}`}
              disabled={!ready}
              onClick={() => session.send({ type: "REQUEST_PROJECTION", studentId: id, requestedBy: assistantId })}
            >
              {st.displayName ?? id.slice(0, 6)} {ready ? "✅" : "…"}
            </button>
          );
        })}
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
      <h1>诞生礼大屏</h1>
      <label>
        房间号
        <input value={roomCode} onChange={(e) => setRoomCode(e.target.value)} placeholder="课堂房间号" autoFocus />
      </label>
      <button type="submit" disabled={!roomCode.trim() || phase === "joining"}>连接大屏</button>
      {phase === "error" && error && <p role="status">连接失败：{error}</p>}
    </form>
  );
}
