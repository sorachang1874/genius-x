/**
 * Testable server factory. Builds Fastify(HTTP) + Socket.IO over the ClassroomController and
 * starts listening. Used by index.ts (production bootstrap) and the E-M1 e2e smoke.
 */
import { Server } from "socket.io";
import type { LessonConfig } from "@genius-x/contracts";
import { lesson001 } from "@genius-x/course-config";
import { makeReducer } from "./engine";
import { validateLessonConfig } from "./engine/validate";
import { InMemorySessionStore, type SessionStore } from "./session/store";
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

  const app = buildHttp(store, lesson.lessonId, lesson.lessonConfigVersion, firstStageId);
  const io = new Server(app.server, { cors: { origin: "*" } });
  const controller = new ClassroomController(lesson, makeReducer(lesson), store, ioEmitter(io), trace, clock);
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
