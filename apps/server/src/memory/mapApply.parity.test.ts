import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { RecordId } from "surrealdb";

import { makeInMemoryMemoryStore } from "./InMemoryMemoryStore.ts";
import type { MapApplyInput, MapIdentity, MemoryStore } from "./MemoryStore.ts";
import { makeSurrealMemoryStore, type MemorySurrealClient } from "./SurrealMemoryStore.ts";

const wording = `Who owns reconnect state? ${"detail ".repeat(40)}`;

const identity = (overrides: Partial<MapIdentity> = {}): MapIdentity => ({
  environmentId: "env-1",
  repositoryKey: "github.com/Quinten1505/memorycode",
  workspaceKey: "/work/app",
  primaryWorkspaceKey: "/work/app",
  threadId: "thread-1",
  turnId: "turn-1",
  ...overrides,
});

const applyInput = (overrides: Partial<MapApplyInput> = {}): MapApplyInput => ({
  idempotencyKey: "chart-reconnect",
  expectedRevision: 0,
  slug: "reconnect",
  title: "How remote sessions reconnect",
  destination: "A spec for reconnect ownership.",
  notes: "Consult wayfinder.",
  identity: identity(),
  questions: [
    {
      slug: "retry-owner",
      title: "Who owns retry state?",
      wording,
      context: "The frontier question.",
      options: [{ label: "The server", context: "One environment graph" }],
    },
  ],
  fog: [{ slug: "mobile", title: "Mobile reconnect", body: "Phone paths are still dim." }],
  exclusions: [
    {
      slug: "editor",
      title: "Graphical editor",
      body: "No new editor in this slice.",
      reason: "The conversation is the entry point.",
    },
  ],
  ...overrides,
});

const idText = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof RecordId) {
    const table =
      typeof value.table === "string"
        ? value.table
        : value.table !== null && typeof value.table === "object" && "name" in value.table
          ? String((value.table as { name: unknown }).name)
          : String(value.table);
    return `${table}:${String(value.id)}`;
  }
  if (value !== null && typeof value === "object" && "tb" in value && "id" in value) {
    const record = value as { tb: unknown; id: unknown };
    return `${String(record.tb)}:${String(record.id)}`;
  }
  return undefined;
};

const rowId = (id: string): { tb: string; id: string } => {
  const colon = id.indexOf(":");
  return { tb: id.slice(0, colon), id: id.slice(colon + 1) };
};

const makeSurrealStub = () => {
  const rows = new Map<string, Record<string, unknown>>();
  const edges: Array<Record<string, unknown>> = [];
  let failNextWrite = false;
  const statements: string[] = [];

  const query: MemorySurrealClient["query"] = async (sql, vars = {}) => {
    statements.push(sql);
    if (sql.includes("BEGIN TRANSACTION")) {
      if (!sql.includes("COMMIT TRANSACTION")) {
        throw new Error("transaction missing commit");
      }
      if (failNextWrite) {
        failNextWrite = false;
        throw new Error("transaction aborted");
      }
      const pendingRows = new Map(rows);
      const pendingEdges = edges.map((edge) => ({ ...edge }));
      const mapId = idText(vars.map_id);
      for (let index = pendingEdges.length - 1; index >= 0; index -= 1) {
        const edge = pendingEdges[index];
        if (edge !== undefined && edge.verb === "contains" && idText(edge.in) === mapId) {
          pendingEdges.splice(index, 1);
        }
      }
      let upsert = 0;
      while (vars[`id_${upsert}`] !== undefined) {
        const id = idText(vars[`id_${upsert}`]);
        const content = vars[`content_${upsert}`];
        if (id !== undefined && content !== null && typeof content === "object") {
          const previous = pendingRows.get(id) ?? {};
          pendingRows.set(id, {
            ...previous,
            ...(content as Record<string, unknown>),
            id: rowId(id),
          });
        }
        upsert += 1;
      }
      let deleted = 0;
      while (vars[`delete_${deleted}`] !== undefined) {
        const id = idText(vars[`delete_${deleted}`]);
        if (id !== undefined) {
          pendingRows.delete(id);
          for (let index = pendingEdges.length - 1; index >= 0; index -= 1) {
            const edge = pendingEdges[index];
            if (edge !== undefined && (idText(edge.in) === id || idText(edge.out) === id)) {
              pendingEdges.splice(index, 1);
            }
          }
        }
        deleted += 1;
      }
      const relate = [...sql.matchAll(/RELATE \$from_(\d+)->([a-z_]+)->\$to_\1/g)];
      for (const match of relate) {
        const index = Number(match[1]);
        const verb = match[2] ?? "contains";
        const from = idText(vars[`from_${index}`]);
        const to = idText(vars[`to_${index}`]);
        const meta = vars[`meta_${index}`];
        if (from === undefined || to === undefined) {
          continue;
        }
        pendingEdges.push({
          id: { tb: verb, id: `${verb}-${from}-${to}` },
          in: rowId(from),
          out: rowId(to),
          verb,
          ...(meta !== null && typeof meta === "object" ? (meta as Record<string, unknown>) : {}),
        });
      }
      const receiptId = idText(vars.receipt_id);
      const receipt = vars.receipt;
      if (receiptId !== undefined && receipt !== null && typeof receipt === "object") {
        pendingRows.set(receiptId, {
          ...(receipt as Record<string, unknown>),
          id: rowId(receiptId),
        });
      }
      rows.clear();
      for (const [id, row] of pendingRows) {
        rows.set(id, row);
      }
      edges.splice(0, edges.length, ...pendingEdges);
      return [];
    }

    if (sql.includes("UPSERT")) {
      const id = idText(vars.id);
      const content = vars.content;
      if (id !== undefined && content !== null && typeof content === "object") {
        const previous = rows.get(id) ?? {};
        const row = { ...previous, ...(content as Record<string, unknown>), id: rowId(id) };
        rows.set(id, row);
        return [row];
      }
      return [];
    }

    if (sql.startsWith("SELECT * FROM ONLY")) {
      const id = idText(vars.id);
      const row = id === undefined ? undefined : rows.get(id);
      return row === undefined ? [] : [row];
    }

    if (sql.startsWith("SELECT * FROM contains WHERE in")) {
      const id = idText(vars.id);
      return edges.filter((edge) => edge.verb === "contains" && idText(edge.in) === id);
    }

    if (sql.startsWith("SELECT * FROM worktree_of WHERE in")) {
      const id = idText(vars.id);
      return edges.filter((edge) => edge.verb === "worktree_of" && idText(edge.in) === id);
    }

    if (sql.includes("FROM work_map WHERE")) {
      return [...rows.values()].filter(
        (row) =>
          row.environment_id === vars.environment &&
          row.user_slug === vars.slug &&
          (row.id as { tb?: string }).tb === "work_map",
      );
    }

    if (sql.includes("WHERE in = $id OR out = $id")) {
      const id = idText(vars.id);
      return edges.filter((edge) => idText(edge.in) === id || idText(edge.out) === id);
    }

    return [];
  };

  const client: MemorySurrealClient = { connect: async () => undefined, query };
  return {
    client,
    statements,
    failNextWrite() {
      failNextWrite = true;
    },
  };
};

const backends: Array<[string, () => { store: MemoryStore; failNextWrite?: () => void }]> = [
  ["in-memory", () => ({ store: makeInMemoryMemoryStore() })],
  [
    "surreal",
    () => {
      const stub = makeSurrealStub();
      return { store: makeSurrealMemoryStore(stub.client), failNextWrite: stub.failNextWrite };
    },
  ],
];

describe("wayfinder map apply", () => {
  for (const [label, makeBackend] of backends) {
    it.effect(`${label} round-trips full content and keeps overview bounded`, () =>
      Effect.gen(function* () {
        const { store } = makeBackend();
        const created = yield* store.applyMap(applyInput());
        const overview = yield* store.readMap({
          identity: identity({ threadId: "thread-2", turnId: "turn-2" }),
          slug: "reconnect",
          view: "overview",
        });
        const full = yield* store.readMap({
          identity: identity({ threadId: "thread-2", turnId: "turn-2" }),
          slug: "reconnect",
          view: "full",
        });
        expect(overview.questions[0]).toEqual({
          id: created.questions[0]?.id,
          slug: "retry-owner",
          title: "Who owns retry state?",
        });
        expect(overview.fog[0]).toEqual({
          id: created.fog[0]?.id,
          slug: "mobile",
          title: "Mobile reconnect",
        });
        expect(overview.exclusions[0]).toEqual({
          id: created.exclusions[0]?.id,
          slug: "editor",
          title: "Graphical editor",
          reason: "The conversation is the entry point.",
        });
        expect(overview.map).not.toHaveProperty("notes");
        expect(full.map.notes).toBe("Consult wayfinder.");
        expect(full.map.destination).toBe("A spec for reconnect ownership.");
        expect(full.questions[0]?.wording).toBe(wording);
        expect(full.questions[0]?.options).toEqual([
          { label: "The server", context: "One environment graph" },
        ]);
        expect(full.fog[0]?.body).toBe("Phone paths are still dim.");
        expect(full.exclusions[0]?.body).toBe("No new editor in this slice.");
        expect(full.provenance).toMatchObject({
          environmentId: "env-1",
          repositoryKey: "github.com/Quinten1505/memorycode",
          workspaceKey: "/work/app",
          sourceThreadId: "thread-1",
          sourceTurnId: "turn-1",
        });
        const card = yield* store.get({ id: created.mapId });
        expect(card.card.scope).toContain("workspace:/work/app");
        expect(card.card.scope).toContain("environment:env-1");
        expect(card.card.scope).not.toContain("project:app");
      }),
    );

    it.effect(`${label} rolls back an invalid batch and keeps existing cards`, () =>
      Effect.gen(function* () {
        const { store } = makeBackend();
        yield* store.remember({
          type: "decision",
          slug: "keep-me",
          title: "Keep this decision",
          body: "still here",
          scope: ["project:memorycode"],
        });
        const error = yield* store
          .applyMap(
            applyInput({
              questions: [
                {
                  slug: "retry-owner",
                  title: "Who owns retry state?",
                  wording,
                  context: "",
                  options: [],
                },
                {
                  slug: "blank",
                  title: "Missing wording",
                  wording: "",
                  context: "",
                  options: [],
                },
              ],
            }),
          )
          .pipe(Effect.flip);
        expect(error.error).toBe("type_mismatch");
        const decision = yield* store.get({ id: "decision:keep-me" });
        expect(decision.card.body).toBe("still here");
        const missing = yield* store
          .readMap({ identity: identity(), slug: "reconnect", view: "full" })
          .pipe(Effect.flip);
        expect(missing.error).toBe("not_found");
      }),
    );

    it.effect(`${label} retries preserve node identity and stale revisions conflict`, () =>
      Effect.gen(function* () {
        const { store } = makeBackend();
        const created = yield* store.applyMap(applyInput());
        const retried = yield* store.applyMap(
          applyInput({
            expectedRevision: 99,
            destination: "A different destination that must not land.",
          }),
        );
        expect(retried).toEqual(created);
        const full = yield* store.readMap({
          identity: identity(),
          slug: "reconnect",
          view: "full",
        });
        expect(full.map.revision).toBe(1);
        expect(full.map.destination).toBe("A spec for reconnect ownership.");
        expect(full.questions[0]?.id).toBe(created.questions[0]?.id);
        const conflict = yield* store
          .applyMap(applyInput({ idempotencyKey: "chart-again", expectedRevision: 0 }))
          .pipe(Effect.flip);
        expect(conflict.error).toBe("revision_conflict");
        expect(conflict.hint).toBe("current revision is 1");
        const updated = yield* store.applyMap(
          applyInput({
            idempotencyKey: "chart-again",
            expectedRevision: 1,
            notes: "Notes after the second save.",
          }),
        );
        expect(updated.mapId).toBe(created.mapId);
        expect(updated.revision).toBe(2);
        expect(updated.questions[0]?.id).toBe(created.questions[0]?.id);
        const reread = yield* store.readMap({
          identity: identity(),
          slug: "reconnect",
          view: "full",
        });
        expect(reread.map.notes).toBe("Notes after the second save.");
        expect(reread.map.revision).toBe(2);
      }),
    );

    it.effect(`${label} separates same-basename workspaces and links worktrees`, () =>
      Effect.gen(function* () {
        const { store } = makeBackend();
        const primary = yield* store.applyMap(applyInput());
        const other = yield* store.applyMap(
          applyInput({
            idempotencyKey: "other-folder",
            identity: identity({
              workspaceKey: "/other/app",
              primaryWorkspaceKey: "/other/app",
              repositoryKey: "github.com/example/other",
              threadId: "thread-other",
            }),
            destination: "The other app.",
          }),
        );
        expect(other.mapId).not.toBe(primary.mapId);
        const otherRead = yield* store.readMap({
          identity: identity({
            workspaceKey: "/other/app",
            primaryWorkspaceKey: "/other/app",
            repositoryKey: "github.com/example/other",
          }),
          slug: "reconnect",
          view: "full",
        });
        expect(otherRead.map.destination).toBe("The other app.");
        const primaryRead = yield* store.readMap({
          identity: identity(),
          slug: "reconnect",
          view: "overview",
        });
        expect(primaryRead.map.destination).toBe("A spec for reconnect ownership.");

        const fromWorktree = yield* store.readMap({
          identity: identity({
            workspaceKey: "/work/app-wt",
            primaryWorkspaceKey: "/work/app",
            threadId: "thread-wt",
            turnId: "turn-wt",
          }),
          slug: "reconnect",
          view: "full",
        });
        expect(fromWorktree.map.destination).toBe("A spec for reconnect ownership.");
        expect(fromWorktree.questions[0]?.wording).toBe(wording);

        const linked = yield* store.applyMap(
          applyInput({
            idempotencyKey: "worktree-chart",
            identity: identity({
              workspaceKey: "/work/app-wt",
              primaryWorkspaceKey: "/work/app",
              threadId: "thread-wt",
              turnId: "turn-wt",
            }),
            destination: "Worktree-specific destination.",
          }),
        );
        expect(linked.mapId).not.toBe(primary.mapId);
        expect(linked.worktreeOf).toBe(linked.primaryProjectId);
        const worktreeProject = yield* store.get({ id: linked.workspaceProjectId });
        expect(worktreeProject.card.edges).toContainEqual(
          expect.objectContaining({ verb: "worktree_of", to: linked.primaryProjectId }),
        );
        const worktreeRead = yield* store.readMap({
          identity: identity({
            workspaceKey: "/work/app-wt",
            primaryWorkspaceKey: "/work/app",
          }),
          slug: "reconnect",
          view: "full",
        });
        expect(worktreeRead.map.destination).toBe("Worktree-specific destination.");
        const stillPrimary = yield* store.readMap({
          identity: identity(),
          slug: "reconnect",
          view: "overview",
        });
        expect(stillPrimary.map.destination).toBe("A spec for reconnect ownership.");
        const sibling = yield* store.readMap({
          identity: identity({
            workspaceKey: "/work/app-wt-2",
            primaryWorkspaceKey: "/work/app",
            threadId: "thread-wt-2",
          }),
          slug: "reconnect",
          view: "overview",
        });
        expect(sibling.map.destination).toBe("A spec for reconnect ownership.");
        const otherKey = yield* store.applyMap(
          applyInput({
            identity: identity({
              environmentId: "env-2",
              workspaceKey: "/work/app",
              primaryWorkspaceKey: "/work/app",
              threadId: "thread-env-2",
            }),
            destination: "Other environment.",
          }),
        );
        expect(otherKey.mapId).not.toBe(primary.mapId);
        expect(otherKey.revision).toBe(1);
      }),
    );

    if (label === "surreal") {
      it.effect(`${label} leaves memory unchanged when the transaction aborts`, () =>
        Effect.gen(function* () {
          const { store, failNextWrite } = makeBackend();
          if (failNextWrite === undefined) {
            return;
          }
          yield* store.remember({
            type: "decision",
            slug: "keep-me",
            title: "Keep this decision",
            body: "still here",
            scope: ["project:memorycode"],
          });
          failNextWrite();
          const error = yield* store.applyMap(applyInput()).pipe(Effect.flip);
          expect(error.error).toBe("backend_unavailable");
          const decision = yield* store.get({ id: "decision:keep-me" });
          expect(decision.card.body).toBe("still here");
          const missing = yield* store
            .readMap({ identity: identity(), slug: "reconnect", view: "full" })
            .pipe(Effect.flip);
          expect(missing.error).toBe("not_found");
        }),
      );
    }
  }

  it.effect("surreal writes one parameterized transaction", () =>
    Effect.gen(function* () {
      const stub = makeSurrealStub();
      const store = makeSurrealMemoryStore(stub.client);
      yield* store.applyMap(applyInput());
      const transaction = stub.statements.find((sql) => sql.includes("BEGIN TRANSACTION"));
      expect(transaction).toBeDefined();
      expect(transaction).toContain("COMMIT TRANSACTION");
      expect(transaction).not.toContain(wording);
      expect(stub.statements.filter((sql) => sql.includes("BEGIN TRANSACTION"))).toHaveLength(1);
    }),
  );
});
