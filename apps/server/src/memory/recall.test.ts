import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import type { StoredMemoryRecord } from "./cards.ts";
import { makeInMemoryMemoryStore } from "./InMemoryMemoryStore.ts";
import { bootstrapFromStore, buildRemember } from "./storeLogic.ts";

const base = {
  slug: "te0820-uio-not-mmap",
  title: "Expose TE0820 PL registers via UIO",
  body: "No /dev/mem.",
  scope: ["project:te0820-hil", "domain:hw"],
};

describe("recall and bootstrap", () => {
  it.effect("recall uses title/body match and live statuses, FTS-only", () =>
    Effect.gen(function* () {
      const store = makeInMemoryMemoryStore();
      yield* store.remember({ type: "decision", ...base });
      yield* store.status({ id: "decision:te0820-uio-not-mmap", status: "accepted" });
      yield* store.remember({
        type: "decision",
        slug: "unrelated-web",
        title: "Use React",
        scope: ["project:other"],
      });
      const result = yield* store.recall({ query: "UIO registers", project: "te0820-hil", k: 8 });
      expect(result.cards.map((c) => c.id)).toContain("decision:te0820-uio-not-mmap");
      expect(result.cards.map((c) => c.id)).not.toContain("decision:unrelated-web");
    }),
  );

  it.effect("bootstrap omits superseded and inbox unless asked, and stays under cap", () =>
    Effect.gen(function* () {
      const store = makeInMemoryMemoryStore();
      for (let i = 0; i < 50; i++) {
        yield* store.remember({
          type: "constraint",
          slug: `pin-${i}`,
          title: `Pin limit ${i} ${"x".repeat(200)}`,
          body: "x".repeat(400),
          scope: ["project:te0820-hil"],
          extra: { severity: "blocker" },
        });
      }
      yield* store.remember({
        type: "thought",
        slug: "inbox-item",
        title: "Inbox",
        scope: ["project:te0820-hil"],
        extra: { facet: "smell" },
      });
      const boot = yield* store.bootstrap({ project: "te0820-hil", max_tokens: 2000 });
      expect(boot.inbox).toBeUndefined();
      expect(boot.constraints.length).toBeGreaterThan(0);
      expect(boot.tokens_est).toBeLessThanOrEqual(2000);
    }),
  );

  it.effect("recall expands one hop along affects even when the neighbor misses the query", () =>
    Effect.gen(function* () {
      const store = makeInMemoryMemoryStore();
      yield* store.remember({ type: "decision", ...base });
      yield* store.status({ id: "decision:te0820-uio-not-mmap", status: "accepted" });
      yield* store.remember({
        type: "component",
        slug: "pl-fabric",
        title: "PL fabric mapper",
        scope: base.scope,
        extra: { kind: "fpga" },
      });
      yield* store.link({
        from: "decision:te0820-uio-not-mmap",
        verb: "affects",
        to: "component:pl-fabric",
      });
      const result = yield* store.recall({ query: "UIO registers", project: "te0820-hil" });
      expect(result.cards.map((card) => card.id)).toContain("decision:te0820-uio-not-mmap");
      expect(result.cards.map((card) => card.id)).toContain("component:pl-fabric");
    }),
  );

  it.effect("stamps valid_from on full-spine create so recent lessons can expire", () =>
    Effect.gen(function* () {
      const created = yield* buildRemember(
        {
          type: "lesson",
          slug: "no-mmap",
          title: "Don't mmap",
          scope: base.scope,
          extra: { kind: "gotcha" },
        },
        "lesson:no-mmap",
        undefined,
      );
      expect(created.record.validFrom).toBeDefined();
      expect(Number.isNaN(Date.parse(created.record.validFrom ?? ""))).toBe(false);

      const topology = yield* buildRemember(
        {
          type: "project",
          slug: "te0820-hil",
          title: "TE0820",
          scope: ["project:te0820-hil"],
        },
        "project:te0820-hil",
        undefined,
      );
      expect(topology.record.validFrom).toBeUndefined();

      const lesson = (id: string, validFrom: string): StoredMemoryRecord => ({
        id,
        type: "lesson",
        title: "Don't mmap",
        body: "",
        status: "active",
        confidence: 0.6,
        scope: ["project:te0820-hil"],
        tags: [],
        extra: { kind: "gotcha" },
        authoredBy: "agent:harness",
        validFrom,
      });
      const boot = bootstrapFromStore(
        [
          lesson("lesson:old", new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString()),
          lesson("lesson:new", new Date().toISOString()),
        ],
        { project: "te0820-hil" },
      );
      expect(boot.recent_lessons.map((card) => card.id)).toEqual(["lesson:new"]);
    }),
  );
});
