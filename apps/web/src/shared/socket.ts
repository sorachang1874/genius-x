/**
 * Typed Socket.IO client over `@genius-x/contracts` (M3). The client only ever sends
 * `ClientMessage` and only ever receives `ServerMessage` — never a locally-redefined shape.
 *
 * The session context (session.tsx) talks to the `ClassroomSocket` interface, not socket.io
 * directly, so tests inject a fake socket and assert the exact `ClientMessage`s emitted.
 *
 * HTTP join is room-code only (no password — Better Auth is shadow / DF-8). Payloads carry
 * refs, never raw media bytes (data-and-privacy contract).
 */
import { io, type Socket } from "socket.io-client";
import type {
  ClientMessage,
  ServerMessage,
  SessionJoinRequest,
  SessionJoinResponse,
  ClassSession,
} from "@genius-x/contracts";

/** Live connection status — drives the "reconnecting" affordance (never an error to the child). */
export type ConnectionStatus = "connecting" | "connected" | "disconnected";

/** The seam session.tsx depends on. Real impl wraps socket.io-client; tests pass a fake. */
export interface ClassroomSocket {
  /** Emit a contract `ClientMessage`. */
  send(msg: ClientMessage): void;
  /** Subscribe to server messages. Returns an unsubscribe fn. */
  onMessage(handler: (msg: ServerMessage) => void): () => void;
  /** Fires on every (re)connect — the session sends HELLO here so resume survives reconnects. */
  onConnect(handler: () => void): () => void;
  /** Connection lifecycle, for the "reconnecting" UI. */
  onStatus(handler: (status: ConnectionStatus) => void): () => void;
  disconnect(): void;
}

export interface ConnectOptions {
  url: string;
  sessionId: string;
  /** Students authenticate the per-student room with a studentId; assistants omit it. */
  studentId?: string | undefined;
}

/**
 * Server base URL. In dev the React app and the Fastify server are separate origins, so the
 * URL is configured via `VITE_SERVER_URL`; default targets the local server (apps/server).
 *
 * If running from a non-localhost host (e.g., WSL2 IP accessed from Windows), use the same
 * hostname to reach the backend — this supports cross-network demo testing.
 */
export function serverBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_SERVER_URL;
  if (typeof fromEnv === "string" && fromEnv.length > 0) return fromEnv;

  // Dynamic: if accessing via IP (e.g., 172.x.x.x from Windows), use same IP for backend
  const hostname = window.location.hostname;
  const protocol = window.location.protocol;
  return `${protocol}//${hostname}:3000`;
}

/** Real `ClassroomSocket` backed by socket.io-client, with the reconnect policy from the design. */
export function connectSocket(opts: ConnectOptions): ClassroomSocket {
  const socket: Socket = io(opts.url, {
    transports: ["websocket"],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
    timeout: 8000,
    auth: opts.studentId
      ? { sessionId: opts.sessionId, studentId: opts.studentId }
      : { sessionId: opts.sessionId },
  });
  return {
    send: (msg) => socket.emit("client_message", msg),
    onMessage: (handler) => {
      const fn = (msg: ServerMessage): void => handler(msg);
      socket.on("server_message", fn);
      return () => socket.off("server_message", fn);
    },
    onConnect: (handler) => {
      socket.on("connect", handler);
      // close the race: the socket auto-connects when io() is called above, which can fire
      // "connect" BEFORE the session attaches this handler. If we're already connected, the
      // event was missed — invoke immediately so HELLO/resume still happens.
      if (socket.connected) handler();
      return () => socket.off("connect", handler);
    },
    onStatus: (handler) => {
      const onConnect = (): void => handler("connected");
      const onDisconnect = (): void => handler("disconnected");
      socket.on("connect", onConnect);
      socket.on("disconnect", onDisconnect);
      return () => {
        socket.off("connect", onConnect);
        socket.off("disconnect", onDisconnect);
      };
    },
    disconnect: () => socket.disconnect(),
  };
}

/** POST /session/join — room code + optional name/role. Returns the assigned studentId + sessionId (+ assistantId if role=assistant). */
export async function joinSession(
  baseUrl: string,
  roomCode: string,
  name?: string,
  role?: "student" | "assistant" | "teacher" | "parent" | "admin",
): Promise<SessionJoinResponse> {
  const body: SessionJoinRequest = { roomCode, ...(name && { name }), ...(role && { role }) };
  const res = await fetch(`${baseUrl}/session/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`join failed (${res.status})`);
  return (await res.json()) as SessionJoinResponse;
}

/**
 * GET /session/:id/state — read-only snapshot. The assistant uses it to learn the current
 * stage on connect (broadcasts only carry *changes*). Best-effort: returns null on any error
 * so a missing/cold session never blocks the panel.
 */
export async function fetchSessionState(
  baseUrl: string,
  sessionId: string,
): Promise<ClassSession | null> {
  try {
    const res = await fetch(`${baseUrl}/session/${encodeURIComponent(sessionId)}/state`);
    if (!res.ok) return null;
    return (await res.json()) as ClassSession;
  } catch {
    return null;
  }
}
