import Fastify from "fastify";
import { Pool } from "pg";

import { BackgroundJobRepository } from "../modules/operations/background-jobs.js";
import { parseEnvironment } from "./environment.schema.js";

async function main(): Promise<void> {
  const env = parseEnvironment(process.env);
  if (env.PROCESS_ROLE !== "worker") throw new Error("WORKER_PROCESS_ROLE_REQUIRED");

  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 5,
    options: "-c role=cashmemo_worker",
  });
  pool.on("error", () => undefined);
  const jobs = new BackgroundJobRepository(pool, {
    backoffBaseMilliseconds: 1_000,
    backoffMaximumMilliseconds: 60_000,
    leaseMilliseconds: 30_000,
  });
  let ready = false;
  const reclaim = async () => {
    await jobs.reclaimExpiredLeases(new Date());
    ready = true;
  };
  await reclaim();
  const timer = setInterval(() => void reclaim().catch(() => (ready = false)), 15_000);
  timer.unref();

  const health = Fastify({ logger: false });
  health.get("/api/v1/health", async (_request, reply) => {
    if (!ready) return reply.code(503).send({ status: "unavailable" });
    return { role: "worker", status: "ok" };
  });
  const shutdown = async () => {
    ready = false;
    clearInterval(timer);
    await health.close();
    await pool.end();
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
  await health.listen({ host: "0.0.0.0", port: env.PORT });
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "WORKER_STARTUP_FAILED");
  process.exitCode = 1;
});
