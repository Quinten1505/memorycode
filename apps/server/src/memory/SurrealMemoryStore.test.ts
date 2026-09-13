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
        if (sql.includes("UPSERT") || sql.includes("MERGE")) {
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
      const content = queryVars(upsert)?.content as Record<string, unknown> | undefined;
      expect(content?.scope).toBeInstanceOf(Set);
      expect([...(content?.scope as Set<string>)]).toEqual(base.scope);
      expect(content?.valid_from).toBeInstanceOf(Date);
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
      const missingExtra = yield* store
        .remember({ type: "constraint", slug, title: base.title, scope: base.scope })
        .pipe(Effect.flip);
      expect(missingExtra.error).toBe("type_mismatch");
      expect(missingExtra.hint).toContain("severity");
      expect(query).not.toHaveBeenCalled();
    }),
  );

  it.effect("reads Surreal sets back as string arrays", () =>
    Effect.gen(function* () {
      const query = vi.fn(async (sql: string) => {
        if (sql.includes("SELECT") && sql.includes("ONLY")) {
          return [
            {
              ...decisionRow,
              scope: new Set(base.scope),
              tags: new Set(["hw"]),
            },
          ];
        }
        return [];
      });
      const store = makeSurrealMemoryStore(makeClient(query));
      const got = yield* store.get({ id: `decision:${slug}` });
      expect(got.card.scope).toEqual(base.scope);
      expect(got.card.tags).toEqual(["hw"]);
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

  it.effect("default recall searches knowledge+thought body tables, not title-only topology", () =>
    Effect.gen(function* () {
      const query = vi.fn(async () => []);
      const store = makeSurrealMemoryStore(makeClient(query));
      yield* store.recall({ query: "UIO registers" });
      const select = query.mock.calls
        .map((call) => querySql(call))
        .find((sql) => sql.includes("SELECT") && sql.includes("~"));
      expect(select).toBeDefined();
      expect(select).toContain("decision");
      expect(select).toContain("thought");
      expect(select).toMatch(/title\s*~\s*\$q/);
      expect(select).toMatch(/body\s*~\s*\$q/);
      expect(select).not.toContain("project");
      expect(select).not.toContain("repo");
      expect(select).not.toContain("artifact");
      expect(select).not.toContain("person");
      expect(select).not.toContain("vendor");
      expect(select).not.toContain("tool");
      expect(select).not.toContain("symbol");
    }),
  );

  it.effect("title-only topology recall does not predicate on body", () =>
    Effect.gen(function* () {
      const query = vi.fn(async () => []);
      const store = makeSurrealMemoryStore(makeClient(query));
      yield* store.recall({ query: "te0820", types: ["project", "decision"] });
      const selects = query.mock.calls
        .map((call) => querySql(call))
        .filter((sql) => sql.includes("SELECT") && sql.includes("~"));
      expect(selects.length).toBeGreaterThan(0);
      const projectSql = selects.find((sql) => sql.includes("project"));
      const decisionSql = selects.find((sql) => sql.includes("decision"));
      expect(projectSql).toBeDefined();
      expect(projectSql).toMatch(/title\s*~\s*\$q/);
      expect(projectSql).not.toMatch(/body\s*~\s*\$q/);
      expect(decisionSql).toBeDefined();
      expect(decisionSql).toMatch(/body\s*~\s*\$q/);
      for (const sql of selects) {
        expect(sql).not.toContain("te0820");
      }
    }),
  );

  it.effect("second remember MERGEs and does not UPSERT CONTENT", () =>
    Effect.gen(function* () {
      const query = vi.fn(async (sql: string) => {
        if (sql.includes("SELECT") && sql.includes("ONLY")) {
          return [decisionRow];
        }
        if (sql.includes("UPDATE") || sql.includes("MERGE")) {
          return [decisionRow];
        }
        return [];
      });
      const store = makeSurrealMemoryStore(makeClient(query));
      yield* store.remember({ type: "decision", ...base });
      const writes = query.mock.calls.map((call) => querySql(call));
      expect(writes.some((sql) => sql.includes("UPSERT") && sql.includes("CONTENT"))).toBe(false);
      expect(writes.some((sql) => sql.includes("MERGE") || sql.includes("UPDATE"))).toBe(true);
      for (const sql of writes) {
        expect(sql).not.toContain(slug);
      }
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

  it.effect("link to a missing record is not_found and does not RELATE", () =>
    Effect.gen(function* () {
      const query = vi.fn(async (sql: string, vars?: Record<string, unknown>) => {
        if (sql.includes("SELECT") && sql.includes("ONLY")) {
          const bound = boundId(vars);
          if (bound.table === "decision" && bound.id === slug) {
            return [decisionRow];
          }
          return [];
        }
        return [];
      });
      const store = makeSurrealMemoryStore(makeClient(query));
      const err = yield* store
        .link({
          from: `decision:${slug}`,
          verb: "affects",
          to: "component:missing",
        })
        .pipe(Effect.flip);
      expect(err.error).toBe("not_found");
      expect(query.mock.calls.some((call) => querySql(call).includes("RELATE"))).toBe(false);
    }),
  );

  it.effect("recall SELECTs one-hop neighbors that did not match FTS", () =>
    Effect.gen(function* () {
      const componentRow = {
        id: { tb: "component", id: "pl-fabric" },
        title: "PL fabric mapper",
        status: "active",
        scope: base.scope,
        tags: [],
        kind: "fpga",
      };
      const query = vi.fn(async (sql: string, vars?: Record<string, unknown>) => {
        if (sql.includes("~")) {
          return [{ ...decisionRow, status: "accepted" }];
        }
        if (Object.hasOwn(vars ?? {}, "ids")) {
          return [componentRow];
        }
        if (sql.includes("FROM in_project") || sql.includes("affects")) {
          return [
            {
              id: { tb: "affects", id: "1" },
              in: { tb: "decision", id: slug },
              out: { tb: "component", id: "pl-fabric" },
            },
          ];
        }
        return [];
      });
      const store = makeSurrealMemoryStore(makeClient(query));
      const result = yield* store.recall({ query: "UIO registers", include_proposed: true });
      expect(result.cards.map((card) => card.id)).toContain(`decision:${slug}`);
      expect(result.cards.map((card) => card.id)).toContain("component:pl-fabric");
      const neighborSelect = query.mock.calls.find((call) =>
        Object.hasOwn(queryVars(call) ?? {}, "ids"),
      );
      expect(neighborSelect).toBeDefined();
      expect(querySql(neighborSelect)).toContain("SELECT * FROM $ids");
    }),
  );
});
