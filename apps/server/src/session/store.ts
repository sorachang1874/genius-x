/**
 * Authoritative ClassSession store. In-memory for local/scripted mode (no container needed);
 * Redis for live/production (same JSON shape). The reducer holds no state — this does.
 *
 * `update()` is an ATOMIC per-session read-modify-write (serialized by a per-session mutex)
 * so concurrent classroom events cannot lose each other's writes (last-write-wins would break
 * `allStudents` gates). The mutex is in-process — correct for a single server instance (MVP);
 * multi-instance scale-out would need a Redis lock/CAS (tracked for later).
 */
import type { ClassSession } from "@genius-x/contracts";
import type { Redis } from "ioredis";

export interface UpdateResult<T> {
  next?: ClassSession | undefined; // the new state to persist (omit to leave unchanged)
  out: T;
}

export interface SessionStore {
  load(sessionId: string): Promise<ClassSession | null>;
  /** Non-atomic direct write — for initial seeding only. Mutations use update(). */
  save(session: ClassSession): Promise<void>;
  /** Atomic per-session read-modify-write. */
  update<T>(sessionId: string, fn: (current: ClassSession | null) => Promise<UpdateResult<T>>): Promise<T>;
}

/** Serializes async work per key (a promise chain per key). */
class KeyedMutex {
  private readonly tails = new Map<string, Promise<unknown>>();
  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const result = prev.then(fn, fn);
    this.tails.set(key, result.then(() => undefined, () => undefined));
    return result;
  }
}

export class InMemorySessionStore implements SessionStore {
  private readonly map = new Map<string, string>();
  private readonly mutex = new KeyedMutex();

  async load(sessionId: string): Promise<ClassSession | null> {
    const json = this.map.get(sessionId);
    return json ? (JSON.parse(json) as ClassSession) : null;
  }

  async save(session: ClassSession): Promise<void> {
    this.map.set(session.sessionId, JSON.stringify(session));
  }

  update<T>(sessionId: string, fn: (current: ClassSession | null) => Promise<UpdateResult<T>>): Promise<T> {
    return this.mutex.run(sessionId, async () => {
      const current = await this.load(sessionId);
      const { next, out } = await fn(current);
      if (next) this.map.set(sessionId, JSON.stringify(next));
      return out;
    });
  }
}

export class RedisSessionStore implements SessionStore {
  private readonly mutex = new KeyedMutex();
  constructor(
    private readonly redis: Redis,
    private readonly prefix = "gx:session:",
  ) {}

  async load(sessionId: string): Promise<ClassSession | null> {
    const json = await this.redis.get(this.prefix + sessionId);
    return json ? (JSON.parse(json) as ClassSession) : null;
  }

  async save(session: ClassSession): Promise<void> {
    await this.redis.set(this.prefix + session.sessionId, JSON.stringify(session));
  }

  update<T>(sessionId: string, fn: (current: ClassSession | null) => Promise<UpdateResult<T>>): Promise<T> {
    return this.mutex.run(sessionId, async () => {
      const current = await this.load(sessionId);
      const { next, out } = await fn(current);
      if (next) await this.redis.set(this.prefix + sessionId, JSON.stringify(next));
      return out;
    });
  }
}
