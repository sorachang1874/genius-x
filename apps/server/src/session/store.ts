/**
 * Authoritative ClassSession store. In-memory for local/scripted mode (no container needed);
 * Redis for live/production (same JSON shape). The reducer holds no state — this does.
 */
import type { ClassSession } from "@genius-x/contracts";
import type { Redis } from "ioredis";

export interface SessionStore {
  load(sessionId: string): Promise<ClassSession | null>;
  save(session: ClassSession): Promise<void>;
}

export class InMemorySessionStore implements SessionStore {
  private readonly map = new Map<string, string>();

  async load(sessionId: string): Promise<ClassSession | null> {
    const json = this.map.get(sessionId);
    return json ? (JSON.parse(json) as ClassSession) : null;
  }

  async save(session: ClassSession): Promise<void> {
    this.map.set(session.sessionId, JSON.stringify(session));
  }
}

export class RedisSessionStore implements SessionStore {
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
}
