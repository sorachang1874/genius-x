/**
 * @genius-x/server bootstrap (composition root). Selects the store by runtime mode, then
 * delegates to startClassroomServer. No business logic here.
 */
import { Redis } from "ioredis";
import { loadConfig } from "@genius-x/config";
import { InMemorySessionStore, RedisSessionStore, type SessionStore } from "./session/store";
import { startClassroomServer } from "./server";

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const liveLike = config.mode === "live" || config.mode === "production";
  const store: SessionStore = liveLike
    ? new RedisSessionStore(new Redis(config.redisUrl!))
    : new InMemorySessionStore();

  const handle = await startClassroomServer({ port: Number(process.env.PORT ?? 3000), store });
  console.log(`genius-x server (mode=${config.mode}) listening on ${handle.url}`);
}

void main();
