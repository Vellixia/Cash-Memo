import type { FastifyInstance } from "fastify";

import type { Pool } from "pg";

import type { SessionService } from "../identity/session.service.js";
import {
  queryFirstPage,
  queryContinuation,
  TraversalError,
  type VersionedTraversalOptions,
} from "./versioned-traversal.service.js";
import type { TraversalQuery } from "./query-fingerprint.js";
import type { CursorCodecOptions } from "./cursor-codec.js";

export interface HistoryControllerOptions {
  pool: Pool;
  sessions: SessionService;
  cursorCodec: CursorCodecOptions;
  traversalOptions: VersionedTraversalOptions;
}

export function registerHistoryRoutes(
  app: FastifyInstance,
  options: Readonly<HistoryControllerOptions>,
): void {
  app.get("/api/v1/memos", async (request, reply) => {
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(",") : value);
    }
    const ctx = await options.sessions.authenticate(headers);
    if (ctx === null) {
      reply.code(401).send();
      return;
    }
    const query = request.query as { cursor?: string; limit?: string; lifecycle?: string };
    const limit = Math.min(Number(query.limit ?? 50), 100);
    const lifecycle = (query.lifecycle ?? "active") as TraversalQuery["lifecycle"];
    const traversalQuery: TraversalQuery = {
      categoryIds: [],
      currencies: [],
      directions: [],
      from: null,
      lifecycle,
      moneySpaceIds: [],
      planningStatuses: [],
      purposes: [],
      searchQuery: null,
      to: null,
    };
    try {
      const page = query.cursor
        ? await queryContinuation(
            options.pool,
            ctx.accountId,
            traversalQuery,
            query.cursor,
            limit,
            options.traversalOptions,
          )
        : await queryFirstPage(
            options.pool,
            ctx.accountId,
            traversalQuery,
            limit,
            options.traversalOptions,
          );
      reply.code(200).send(page);
    } catch (error) {
      if (error instanceof TraversalError && error.code === "RESULTS_CHANGED") {
        reply.code(409).send({ messageCode: "RESULTS_CHANGED", restartRequired: true });
      } else {
        reply.code(500).send({ messageCode: "INTERNAL_ERROR" });
      }
    }
  });
}
