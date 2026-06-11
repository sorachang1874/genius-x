/**
 * Testable server factory. Builds Fastify(HTTP) + Socket.IO over the ClassroomController and
 * starts listening. Used by index.ts (production bootstrap) and the E-M1 e2e smoke.
 */
import { Server } from "socket.io";
import type { LessonConfig } from "@genius-x/contracts";
import { AiGateway, BRAND_STYLE_V0, FakeProvider, KeywordSafetyFilter, PresetFallbackLibrary } from "@genius-x/ai-gateway";
import { lesson001 } from "@genius-x/course-config";
import { makeReducer } from "./engine";
import { validateLessonConfig } from "./engine/validate";
import { InMemorySessionStore, type SessionStore } from "./session/store";
import { InMemoryTurnBufferStore, type TurnBufferStore } from "./session/turnbuffer";
import type { IdentityService } from "./identity/service";
import type { WorkspaceService } from "./workspace/service";
import type { IpCharacterService } from "./workspace/ip-character";
import { consoleNotificationSink, LessonShareMinter, type NotificationSink, type ShareService } from "./share/service";
import { ClassroomController, type Clock, type TraceSink } from "./sync/controller";
import { attachSocket, ioEmitter } from "./sync/socket";
import { buildHttp } from "./http";

export interface ServerOptions {
  port?: number;
  /** Bind host. Defaults to 0.0.0.0 (externally reachable, for production). Tests pass 127.0.0.1. */
  host?: string;
  store?: SessionStore;
  lesson?: LessonConfig;
  trace?: TraceSink;
  clock?: Clock;
  /** Tenant that owns sessions created by this server (Phase 1: single demo tenant). */
  tenantId?: string;
  /** Identity Service (Phase 1). Absent ⇒ enrollment/admin endpoints disabled (logged loudly). */
  identity?: IdentityService;
  /** Workspace Service (Phase 2). Absent ⇒ workspace reads disabled + classroom writes skipped (traced). */
  workspace?: WorkspaceService;
  /** IP character entity (Phase 4.5). Absent ⇒ lesson-end IP writes skipped (traced); canon falls back to the profile mirror. */
  ipCharacter?: IpCharacterService;
  /** Test seam: inject a pre-configured gateway (e.g. FakeProvider with canned content).
   *  The injected gateway owns ALL its deps INCLUDING brandStyle — omitting brandStyle is
   *  loud (`brand_style_absent` traced per image call), never silently unstyled. */
  gateway?: AiGateway;
  /** Share Service (Phase 3). Absent ⇒ share endpoint + lesson-end minting disabled (traced). */
  share?: ShareService;
  /** Parent web origin for capability URLs (default dev Vite origin). */
  webBaseUrl?: string;
  /** Notification seam (default: console — operator forwards the link manually). */
  notify?: NotificationSink;
  /**
   * Phase 4 hot-path turn buffer (agent-context.md). Default: in-memory (classroom-tier,
   * always wired — context is a CORE coherence feature); index.ts passes the Redis impl
   * in live/production so buffers survive a process restart alongside sessions.
   */
  turnBuffer?: TurnBufferStore;
  /** CORS origin ("*" default for dev; pin in operator deployments — see buildHttp). */
  corsOrigin?: string;
}

export interface ServerHandle {
  url: string;
  port: number;
  close(): Promise<void>;
}

const consoleTrace: TraceSink = { record: (e) => console.log("[trace]", e.kind, e.payload) };

/**
 * GATEWAY_MAX_CONCURRENT must be a positive integer (default 8). FAIL LOUD at boot on a
 * malformed value: a typo ("abc" → NaN) would otherwise disable the DF-v2-19 concurrency
 * floor silently — the forbidden invisible fallback, on an operator knob no less.
 */
export function parseGatewayMaxConcurrent(raw: string | undefined): number {
  if (raw === undefined || raw === "") return 8;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`GATEWAY_MAX_CONCURRENT must be a positive integer, got "${raw}"`);
  }
  return n;
}

export async function startClassroomServer(opts: ServerOptions = {}): Promise<ServerHandle> {
  let lesson = opts.lesson;
  if (!lesson) {
    const validated = validateLessonConfig(lesson001);
    if (!validated.ok) throw new Error(`Invalid lesson config: ${validated.errors.join("; ")}`);
    lesson = validated.lesson;
  }

  const store = opts.store ?? new InMemorySessionStore();
  const trace = opts.trace ?? consoleTrace;
  const clock = opts.clock ?? { now: () => new Date().toISOString() };
  const firstStageId = lesson.stages[0]!.stageId;

  const gateway = opts.gateway ?? new AiGateway({
    provider: new FakeProvider(),
    safety: new KeywordSafetyFilter(),
    fallback: new PresetFallbackLibrary(),
    trace,
    now: () => clock.now(),
    // brand-style.md: every image call carries the versioned brand style (v0 placeholder,
    // DF-v2-18). A gateway without it traces brand_style_absent per call.
    brandStyle: BRAND_STYLE_V0,
    // DF-v2-19 operational floor: bound the provider burst a class-wide unlock creates
    // (queue wait precedes the capability deadline; the thinking animation covers it).
    // Malformed env fails loud at boot — never a silently-unbounded gateway.
    maxConcurrentCalls: parseGatewayMaxConcurrent(process.env.GATEWAY_MAX_CONCURRENT),
  });
  const webBaseUrl = opts.webBaseUrl ?? "http://localhost:5173";
  const app = buildHttp(store, {
    lessonId: lesson.lessonId,
    lessonConfigVersion: lesson.lessonConfigVersion,
    firstStageId,
    ...(opts.tenantId && { tenantId: opts.tenantId }),
    ...(opts.identity && { identity: opts.identity }),
    ...(opts.workspace && { workspace: opts.workspace }),
    ...(opts.share && { share: opts.share }),
    webBaseUrl,
    ...(opts.corsOrigin && { corsOrigin: opts.corsOrigin }),
    trace,
  });
  const shareMinter = opts.share
    ? new LessonShareMinter(opts.share, opts.notify ?? consoleNotificationSink, webBaseUrl)
    : undefined;
  // Same origin policy as HTTP (note: CORS cannot gate non-browser WS clients — the real
  // guard is the controller's deny-unknown-student resume, Phase 1 Step 5).
  const io = new Server(app.server, { cors: { origin: opts.corsOrigin ?? "*" } });
  const turnBuffer = opts.turnBuffer ?? new InMemoryTurnBufferStore();
  const controller = new ClassroomController(lesson, makeReducer(lesson), store, ioEmitter(io), trace, clock, gateway, opts.identity, opts.workspace, shareMinter, turnBuffer, opts.ipCharacter);
  attachSocket(io, controller);

  const host = opts.host ?? "0.0.0.0";
  await app.ready();
  await app.listen({ port: opts.port ?? 0, host });
  const addr = app.server.address();
  const port = typeof addr === "object" && addr ? addr.port : (opts.port ?? 0);
  const urlHost = host === "0.0.0.0" ? "localhost" : host;

  return {
    url: `http://${urlHost}:${port}`,
    port,
    close: async () => {
      await io.close();
      await app.close();
    },
  };
}
