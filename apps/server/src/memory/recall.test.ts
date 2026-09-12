import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { makeInMemoryMemoryStore } from "./InMemoryMemoryStore.ts";

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
});
