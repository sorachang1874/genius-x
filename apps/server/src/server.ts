/**
 * Testable server factory. Builds Fastify(HTTP) + Socket.IO over the ClassroomController and
 * starts listening. Used by index.ts (production bootstrap) and the E-M1 e2e smoke.
 */
import { Server } from "socket.io";
import type { LessonConfig } from "@genius-x/contracts";
import { AiGateway, FakeProvider, KeywordSafetyFilter, PresetFallbackLibrary } from "@genius-x/ai-gateway";
import { lesson001 } from "@genius-x/course-config";
import { makeReducer } from "./engine";
import { validateLessonConfig } from "./engine/validate";
import { InMemorySessionStore, type SessionStore } from "./session/store";
import type { IdentityService } from "./identity/service";
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
  /** CORS origin ("*" default for dev; pin in operator deployments — see buildHttp). */
  corsOrigin?: string;
}

export interface ServerHandle {
  url: string;
  port: number;
  close(): Promise<void>;
}

const consoleTrace: TraceSink = { record: (e) => console.log("[trace]", e.kind, e.payload) };

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

  const gateway = new AiGateway({
    provider: new FakeProvider(),
    safety: new KeywordSafetyFilter(),
    fallback: new PresetFallbackLibrary(),
    trace,
    now: () => clock.now(),
  });
  const app = buildHttp(store, lesson.lessonId, lesson.lessonConfigVersion, firstStageId, opts.tenantId, opts.identity, opts.corsOrigin, trace);
  // Same origin policy as HTTP (note: CORS cannot gate non-browser WS clients — the real
  // guard is the controller's deny-unknown-student resume, Phase 1 Step 5).
  const io = new Server(app.server, { cors: { origin: opts.corsOrigin ?? "*" } });
  const controller = new ClassroomController(lesson, makeReducer(lesson), store, ioEmitter(io), trace, clock, gateway);
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
