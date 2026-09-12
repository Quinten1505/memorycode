import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { vi } from "vite-plus/test";

import { makeSurrealMemoryStore, type MemorySurrealClient } from "./SurrealMemoryStore.ts";

const slug = "te0820-uio-not-mmap";
const base = {
  slug,
  title: "Expose TE0820 PL registers via UIO",
  body: "No /dev/mem.",
  scope: ["project:te0820-hil", "domain:hw"],
};

const decisionRow = {
  id: { tb: "decision", id: slug },
  title: base.title,
  body: base.body,
  status: "proposed",
  confidence: 0.6,
  scope: base.scope,
  tags: [],
  authored_by: { tb: "agent", id: "harness" },
};

const makeClient = (query: MemorySurrealClient["query"]): MemorySurrealClient => ({
  connect: vi.fn(async () => undefined),
  query,
});

const querySql = (call: unknown): string => String((call as unknown[])[0]);
const queryVars = (call: unknown): Record<string, unknown> | undefined =>
  (call as unknown[])[1] as Record<string, unknown> | undefined;

const boundId = (vars: Record<string, unknown> | undefined) => {
  const id = vars?.id as { tb?: string; table?: unknown; id?: unknown } | undefined;
  const table =
    typeof id?.tb === "string"
      ? id.tb
      : typeof id?.table === "string"
        ? id.table
        : id?.table !== null && typeof id?.table === "object" && "name" in id.table
          ? String((id.table as { name: unknown }).name)
          : undefined;
  return {
    table,
    id: id?.id === undefined ? undefined : String(id.id),
  };
};

describe("SurrealMemoryStore", () => {
  it.effect("remember issues parameterized SurrealQL and never interpolates slug", () =>
    Effect.gen(function* () {
      const query = vi.fn(async (sql: string) => {
        if (sql.includes("UPSERT") || sql.includes("CONTENT")) {
          return [decisionRow];
        }
        return [];
      });
      const store = makeSurrealMemoryStore(makeClient(query));
      const created = yield* store.remember({ type: "decision", ...base });
      expect(created.card.id).toBe(`decision:${slug}`);
      expect(created.card.status).toBe("proposed");
      expect(query).toHaveBeenCalled();
      const upsert = query.mock.calls.find((call) => querySql(call).includes("UPSERT"));
      expect(upsert).toBeDefined();
      for (const call of query.mock.calls) {
        expect(querySql(call)).not.toContain(slug);
      }
      expect(boundId(queryVars(upsert))).toEqual({ table: "decision", id: slug });
    }),
  );

  it.effect("validates in TypeScript before querying", () =>
    Effect.gen(function* () {
      const query = vi.fn(async () => []);
      const store = makeSurrealMemoryStore(makeClient(query));
      const unknown = yield* store.remember({ type: "wiki", ...base }).pipe(Effect.flip);
      expect(unknown.error).toBe("unknown_type");
      const missingScope = yield* store
        .remember({ type: "decision", slug, title: base.title, scope: [] })
        .pipe(Effect.flip);
      expect(missingScope.error).toBe("scope_required");
      expect(query).not.toHaveBeenCalled();
    }),
  );

  it.effect("maps SDK throws to backend_unavailable", () =>
    Effect.gen(function* () {
      const query = vi.fn(async () => {
        throw new Error("ws down");
      });
      const store = makeSurrealMemoryStore(makeClient(query));
      const err = yield* store.get({ id: `decision:${slug}` }).pipe(Effect.flip);
      expect(err.error).toBe("backend_unavailable");
    }),
  );

  it.effect("link binds RecordIds and does not interpolate slugs", () =>
    Effect.gen(function* () {
      const query = vi.fn(async (sql: string) => {
        if (sql.includes("SELECT") && sql.includes("ONLY")) {
          return [decisionRow];
        }
        return [];
      });
      const store = makeSurrealMemoryStore(makeClient(query));
      yield* store.remember({ type: "decision", ...base });
      yield* store.remember({
        type: "component",
        slug: "uio-map",
        title: "uio_map",
        scope: base.scope,
        extra: { kind: "firmware" },
      });
      query.mockClear();
      const result = yield* store.link({
        from: `decision:${slug}`,
        verb: "affects",
        to: "component:uio-map",
      });
      expect(result.ok).toBe(true);
      expect(query.mock.calls.length).toBeGreaterThan(0);
      for (const call of query.mock.calls) {
        const sql = querySql(call);
        expect(sql).not.toContain(slug);
        expect(sql).not.toContain("uio-map");
      }
    }),
  );
});
