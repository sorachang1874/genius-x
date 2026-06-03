/**
 * Session context (M3) — the single place the UI reads classroom state and sends contract
 * messages. The server holds authoritative state; this client *renders from it* and never
 * invents state (client-server contract §8.2):
 *
 *  - On every (re)connect the student sends HELLO → server replies RESUME_STATE; we render
 *    `currentStageId`, `global`, and `you` (incl. `you.outputs.avatarUrl`) from that payload,
 *    NOT from locally-held AI output. Candidate images (pre-selection) are transient.
 *  - The assistant has no studentId and must NOT send HELLO (that would register a phantom
 *    student and skew class-wide advance conditions); it learns the current stage from a
 *    read-only GET on connect and from STAGE_UNLOCK broadcasts.
 *
 * Transport seams (connect/join/fetchState) are injectable so tests drive a fake socket and
 * assert the exact `ClientMessage` shapes emitted.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import type {
  ClientMessage,
  ServerMessage,
  StageId,
  GlobalState,
  StudentRuntimeState,
  ClientAiOutput,
  InteractionInput,
  StageCompletePayload,
  SessionJoinResponse,
  ClassSession,
} from "@genius-x/contracts";
import {
  connectSocket,
  joinSession,
  fetchSessionState,
  serverBaseUrl,
  type ClassroomSocket,
  type ConnectOptions,
  type ConnectionStatus,
} from "./socket";

export type Role = "student" | "assistant";
export type Phase = "idle" | "joining" | "error" | "live";

/** Empty per-student state before RESUME_STATE arrives (mirrors the server's freshStudentState). */
function freshStudentState(): StudentRuntimeState {
  return {
    stageStatus: {},
    interactionCounts: {},
    completedInteractionIds: [],
    selectedVariant: {},
    pending: {},
    outputs: {},
  };
}

export interface SessionState {
  role: Role;
  phase: Phase;
  error?: string | undefined;
  connection: ConnectionStatus;
  sessionId?: string | undefined;
  studentId?: string | undefined;
  assistantId?: string | undefined;
  currentStageId?: StageId | undefined;
  global: GlobalState;
  lessonConfigVersion?: string | undefined;
  /** Authoritative per-student state (from RESUME_STATE), with optimistic local selection. */
  you: StudentRuntimeState;
  /** In-flight interaction id — drives the "thinking" UI; cleared by AI_OUTPUT/stage change. */
  pendingInteractionId?: string | undefined;
  /** Latest AI output for this student (e.g. shape candidate images). Transient. */
  lastOutput?: { interactionId: string; output: ClientAiOutput } | undefined;
}

type Action =
  | { t: "JOIN_START" }
  | { t: "JOIN_OK"; sessionId: string; studentId?: string; assistantId?: string }
  | { t: "JOIN_ERROR"; error: string }
  | { t: "CONNECTION"; status: ConnectionStatus }
  | { t: "CLASS_STATE"; currentStageId: StageId; global: GlobalState }
  | { t: "SERVER"; msg: ServerMessage }
  | { t: "INTERACT_SENT"; interactionId: string }
  | { t: "LOCAL_SELECT"; output: string; value: StudentRuntimeState["outputs"][string] };

function reduce(state: SessionState, action: Action): SessionState {
  switch (action.t) {
    case "JOIN_START":
      return { ...state, phase: "joining", error: undefined };
    case "JOIN_OK":
      return {
        ...state,
        phase: "live",
        sessionId: action.sessionId,
        studentId: action.studentId,
        assistantId: action.assistantId,
      };
    case "JOIN_ERROR":
      return { ...state, phase: "error", error: action.error };
    case "CONNECTION":
      return { ...state, connection: action.status };
    case "CLASS_STATE":
      return { ...state, currentStageId: action.currentStageId, global: action.global };
    case "INTERACT_SENT":
      return { ...state, pendingInteractionId: action.interactionId };
    case "LOCAL_SELECT":
      // optimistic: the child sees the avatar they chose immediately; resume reconciles it.
      return { ...state, you: { ...state.you, outputs: { ...state.you.outputs, [action.output]: action.value } } };
    case "SERVER":
      return applyServer(state, action.msg);
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

function applyServer(state: SessionState, msg: ServerMessage): SessionState {
  switch (msg.type) {
    case "STAGE_UNLOCK":
      // class advanced: drop transient interaction state (candidate images don't survive a stage change)
      return { ...state, currentStageId: msg.stageId, global: "active", pendingInteractionId: undefined, lastOutput: undefined };
    case "GLOBAL_STATE":
      return { ...state, global: msg.state };
    case "AI_OUTPUT":
      if (state.studentId && msg.studentId !== state.studentId) return state; // not ours (defensive)
      return {
        ...state,
        pendingInteractionId: state.pendingInteractionId === msg.interactionId ? undefined : state.pendingInteractionId,
        lastOutput: { interactionId: msg.interactionId, output: msg.output },
      };
    case "RESUME_STATE":
      // authoritative re-hydration — render from the server's `you`, not local state.
      return {
        ...state,
        phase: "live",
        currentStageId: msg.currentStageId,
        global: msg.global,
        lessonConfigVersion: msg.lessonConfigVersion,
        you: msg.you,
        pendingInteractionId: undefined,
        lastOutput: undefined,
      };
    case "AI_READY": // M4 (prepared birth output)
    case "PROJECT": // M4 (teacher projection)
      return state;
    default: {
      const _exhaustive: never = msg;
      return _exhaustive;
    }
  }
}

/** Stable id for interactions/selection. crypto.randomUUID exists in browsers + jsdom/node. */
function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Math.random().toString(36).slice(2)}`;
}

export interface SessionApi extends SessionState {
  /** Student: POST /session/join then open the socket. Assistant: open the socket on the room code. */
  join(roomCode: string, name?: string): Promise<void>;
  /** Send an interaction input (triggers an AI call). Returns the interactionId. No-op if not a student. */
  interact(stageId: StageId, input: InteractionInput, variantId?: string): string | undefined;
  /** Finish/choose for a stage (e.g. avatar selection). Optimistically reflects a selection locally. */
  complete(stageId: StageId, payload: StageCompletePayload): void;
  /** Escape hatch for control messages the assistant builds from the lesson config (UNLOCK etc.). */
  send(msg: ClientMessage): void;
}

/** Exported for tests so stage components can be rendered with a fake session value. */
export const SessionContext = createContext<SessionApi | null>(null);

export interface SessionProviderProps {
  role: Role;
  /** Demo assistant identity (DF-M3-4); ignored for students. */
  assistantId?: string;
  children: ReactNode;
  /** Injectable seams (tests pass fakes; defaults hit the real server). */
  deps?: {
    connect?: (opts: ConnectOptions) => ClassroomSocket;
    join?: (roomCode: string, name?: string) => Promise<SessionJoinResponse>;
    fetchState?: (sessionId: string) => Promise<ClassSession | null>;
    wsUrl?: string;
  };
}

export function SessionProvider({ role, assistantId, children, deps }: SessionProviderProps): React.JSX.Element {
  const base = serverBaseUrl();
  const wsUrl = deps?.wsUrl ?? base;
  const connect = deps?.connect ?? connectSocket;
  const doJoin = deps?.join ?? ((roomCode: string, name?: string) => joinSession(base, roomCode, name));
  const doFetchState = deps?.fetchState ?? ((sessionId: string) => fetchSessionState(base, sessionId));

  const [state, dispatch] = useReducer(reduce, {
    role,
    phase: "idle",
    connection: "connecting",
    global: "standby",
    you: freshStudentState(),
  });

  const socketRef = useRef<ClassroomSocket | null>(null);

  const join = useCallback(
    async (roomCode: string, name?: string): Promise<void> => {
      dispatch({ t: "JOIN_START" });
      try {
        if (role === "student") {
          const res = await doJoin(roomCode, name);
          dispatch({ t: "JOIN_OK", sessionId: res.sessionId, studentId: res.studentId });
        } else {
          const aid = assistantId ?? "assistant-1";
          dispatch({ t: "JOIN_OK", sessionId: roomCode, assistantId: aid });
          // best-effort: learn the current stage right away (broadcasts only carry changes)
          const snapshot = await doFetchState(roomCode);
          if (snapshot) dispatch({ t: "CLASS_STATE", currentStageId: snapshot.currentStageId, global: snapshot.global });
        }
      } catch (err) {
        dispatch({ t: "JOIN_ERROR", error: err instanceof Error ? err.message : String(err) });
      }
    },
    [role, assistantId, doJoin, doFetchState],
  );

  // Open the socket once we have a session id (+ studentId for students). Re-runs if identity changes.
  const sessionId = state.sessionId;
  const studentId = state.studentId;
  useEffect(() => {
    if (!sessionId) return;
    if (role === "student" && !studentId) return;

    const sock = connect({ url: wsUrl, sessionId, studentId });
    socketRef.current = sock;
    const offMessage = sock.onMessage((msg) => dispatch({ t: "SERVER", msg }));
    const offStatus = sock.onStatus((status) => dispatch({ t: "CONNECTION", status }));
    const offConnect = sock.onConnect(() => {
      // students resume by HELLO on every (re)connect; assistants never send HELLO.
      if (role === "student" && studentId) sock.send({ type: "HELLO", studentId });
    });
    return () => {
      offMessage();
      offStatus();
      offConnect();
      sock.disconnect();
      socketRef.current = null;
    };
  }, [connect, wsUrl, sessionId, studentId, role]);

  const send = useCallback((msg: ClientMessage): void => {
    socketRef.current?.send(msg);
  }, []);

  const interact = useCallback(
    (stageId: StageId, input: InteractionInput, variantId?: string): string | undefined => {
      if (!studentId) return undefined;
      const interactionId = newId();
      const msg: ClientMessage = variantId
        ? { type: "INTERACT", studentId, stageId, interactionId, variantId, input }
        : { type: "INTERACT", studentId, stageId, interactionId, input };
      send(msg);
      dispatch({ t: "INTERACT_SENT", interactionId });
      return interactionId;
    },
    [studentId, send],
  );

  const complete = useCallback(
    (stageId: StageId, payload: StageCompletePayload): void => {
      if (!studentId) return;
      send({ type: "STAGE_COMPLETE", studentId, stageId, payload } satisfies ClientMessage);
      if (payload.kind === "selection") dispatch({ t: "LOCAL_SELECT", output: payload.output, value: payload.value });
    },
    [studentId, send],
  );

  const api = useMemo<SessionApi>(
    () => ({ ...state, join, interact, complete, send }),
    [state, join, interact, complete, send],
  );

  return <SessionContext.Provider value={api}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionApi {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within <SessionProvider>");
  return ctx;
}
