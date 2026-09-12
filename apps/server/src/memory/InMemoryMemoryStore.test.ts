import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { makeInMemoryMemoryStore } from "./InMemoryMemoryStore.ts";

const base = {
  slug: "te0820-uio-not-mmap",
  title: "Expose TE0820 PL registers via UIO",
  body: "No /dev/mem.",
  scope: ["project:te0820-hil", "domain:hw"],
};

describe("InMemoryMemoryStore", () => {
  it.effect("creates a decision as proposed and fetches it", () =>
    Effect.gen(function* () {
      const store = makeInMemoryMemoryStore();
      const created = yield* store.remember({ type: "decision", ...base });
      expect(created.card.id).toBe("decision:te0820-uio-not-mmap");
      expect(created.card.status).toBe("proposed");
      const got = yield* store.get({ id: created.card.id });
      expect(got.card.title).toBe(base.title);
    }),
  );

  it.effect("rejects unknown type and invalid slug", () =>
    Effect.gen(function* () {
      const store = makeInMemoryMemoryStore();
      const unknown = yield* store.remember({ type: "wiki", ...base }).pipe(Effect.flip);
      expect(unknown.error).toBe("unknown_type");
      const slug = yield* store
        .remember({ type: "decision", ...base, slug: "NOPE" })
        .pipe(Effect.flip);
      expect(slug.error).toBe("invalid_slug");
    }),
  );

  it.effect("rejects live body mutation without supersede", () =>
    Effect.gen(function* () {
      const store = makeInMemoryMemoryStore();
      yield* store.remember({ type: "decision", ...base });
      yield* store.status({ id: "decision:te0820-uio-not-mmap", status: "accepted" });
      const err = yield* store
        .remember({ type: "decision", ...base, body: "changed meaning" })
        .pipe(Effect.flip);
      expect(err.error).toBe("immutable_live_body");
    }),
  );

  it.effect("keeps constraint proposed without confirm", () =>
    Effect.gen(function* () {
      const store = makeInMemoryMemoryStore();
      const created = yield* store.remember({
        type: "constraint",
        slug: "no-mmap",
        title: "No /dev/mem",
        scope: ["project:te0820-hil"],
        extra: { severity: "blocker" },
      });
      expect(created.card.status).toBe("proposed");
      const err = yield* store.status({ id: created.card.id, status: "active" }).pipe(Effect.flip);
      expect(err.error).toBe("confirm_required");
    }),
  );

  it.effect("supersedes hides old from live get-filter but memory_get still returns it", () =>
    Effect.gen(function* () {
      const store = makeInMemoryMemoryStore();
      yield* store.remember({ type: "decision", ...base });
      yield* store.remember({
        type: "decision",
        slug: "te0820-uio-v2",
        title: "Successor",
        scope: base.scope,
      });
      yield* store.status({
        id: "decision:te0820-uio-not-mmap",
        status: "superseded",
        successor: "decision:te0820-uio-v2",
      });
      const old = yield* store.get({ id: "decision:te0820-uio-not-mmap" });
      expect(old.card.status).toBe("superseded");
      expect(old.card.edges).toContainEqual({
        verb: "supersedes",
        to: "decision:te0820-uio-v2",
        meta: { reason: "", direction: "in" },
      });
      expect(
        old.card.edges.some((edge) => edge.verb === "supersedes" && edge.meta?.direction !== "in"),
      ).toBe(false);
    }),
  );

  it.effect("rejects unknown verb and IN/OUT mismatch", () =>
    Effect.gen(function* () {
      const store = makeInMemoryMemoryStore();
      yield* store.remember({ type: "decision", ...base });
      yield* store.remember({
        type: "component",
        slug: "uio-map",
        title: "uio_map",
        scope: base.scope,
        extra: { kind: "firmware" },
      });
      const verb = yield* store
        .link({ from: "decision:te0820-uio-not-mmap", verb: "related_to", to: "component:uio-map" })
        .pipe(Effect.flip);
      expect(verb.error).toBe("unknown_verb");
      const mismatch = yield* store
        .link({ from: "decision:te0820-uio-not-mmap", verb: "implements", to: "component:uio-map" })
        .pipe(Effect.flip);
      expect(mismatch.error).toBe("type_mismatch");
    }),
  );

  it.effect("reclassify moves a thought onto an existing type", () =>
    Effect.gen(function* () {
      const store = makeInMemoryMemoryStore();
      yield* store.remember({
        type: "thought",
        slug: "maybe-uio",
        title: "Maybe UIO",
        body: "…",
        scope: base.scope,
        extra: { facet: "open-question" },
      });
      const result = yield* store.reclassify({
        from: "thought:maybe-uio",
        to_type: "decision",
        to_slug: "te0820-uio-not-mmap",
        title: base.title,
        body: base.body,
      });
      expect(result.card.id).toBe("decision:te0820-uio-not-mmap");
      const thought = yield* store.get({ id: "thought:maybe-uio" });
      expect(thought.card.status).toBe("promoted");
    }),
  );

  it.effect("requires scope on remember", () =>
    Effect.gen(function* () {
      const store = makeInMemoryMemoryStore();
      const err = yield* store
        .remember({ type: "decision", slug: "x", title: "x", scope: [] })
        .pipe(Effect.flip);
      expect(err.error).toBe("scope_required");
    }),
  );

  it.effect("rejects missing SCHEMAFULL extras with type_mismatch and a hint", () =>
    Effect.gen(function* () {
      const store = makeInMemoryMemoryStore();
      const cases = [
        { type: "constraint", missing: "severity" },
        { type: "lesson", missing: "kind" },
        { type: "schema_proposal", missing: "proposed_table" },
        { type: "component", missing: "kind" },
        { type: "interface", missing: "kind" },
        { type: "person", missing: "kind" },
        { type: "tool", missing: "kind" },
      ] as const;
      for (const [index, { type, missing }] of cases.entries()) {
        const err = yield* store
          .remember({
            type,
            slug: `missing-${index}`,
            title: "Missing extra",
            scope: base.scope,
          })
          .pipe(Effect.flip);
        expect(err.error).toBe("type_mismatch");
        expect(err.hint).toContain(missing);
      }
    }),
  );

  it.effect("link to a missing record is not_found", () =>
    Effect.gen(function* () {
      const store = makeInMemoryMemoryStore();
      yield* store.remember({ type: "decision", ...base });
      const err = yield* store
        .link({
          from: "decision:te0820-uio-not-mmap",
          verb: "affects",
          to: "component:does-not-exist",
        })
        .pipe(Effect.flip);
      expect(err.error).toBe("not_found");
    }),
  );

  it.effect("reclassify rejects to_type outside promoted_to.out before remember", () =>
    Effect.gen(function* () {
      const store = makeInMemoryMemoryStore();
      yield* store.remember({
        type: "thought",
        slug: "maybe-component",
        title: "Maybe a component",
        scope: base.scope,
        extra: { facet: "open-question" },
      });
      const err = yield* store
        .reclassify({
          from: "thought:maybe-component",
          to_type: "component",
          to_slug: "uio-map",
          extra: { kind: "firmware" },
        })
        .pipe(Effect.flip);
      expect(err.error).toBe("type_mismatch");
      const missing = yield* store.get({ id: "component:uio-map" }).pipe(Effect.flip);
      expect(missing.error).toBe("not_found");
      const thought = yield* store.get({ id: "thought:maybe-component" });
      expect(thought.card.status).toBe("inbox");
    }),
  );

  it.effect("defaults depends_on.kind to runtime and supersedes.reason from status", () =>
    Effect.gen(function* () {
      const store = makeInMemoryMemoryStore();
      yield* store.remember({
        type: "component",
        slug: "uio-map",
        title: "uio_map",
        scope: base.scope,
        extra: { kind: "firmware" },
      });
      yield* store.remember({
        type: "component",
        slug: "pl-fabric",
        title: "PL fabric",
        scope: base.scope,
        extra: { kind: "fpga" },
      });
      yield* store.link({
        from: "component:uio-map",
        verb: "depends_on",
        to: "component:pl-fabric",
      });
      const linked = yield* store.get({ id: "component:uio-map" });
      expect(linked.card.edges).toContainEqual({
        verb: "depends_on",
        to: "component:pl-fabric",
        meta: { kind: "runtime" },
      });

      yield* store.remember({ type: "decision", ...base });
      yield* store.remember({
        type: "decision",
        slug: "te0820-uio-v2",
        title: "Successor",
        scope: base.scope,
      });
      yield* store.status({
        id: "decision:te0820-uio-not-mmap",
        status: "superseded",
        successor: "decision:te0820-uio-v2",
        reason: "replaced by v2",
      });
      const old = yield* store.get({ id: "decision:te0820-uio-not-mmap" });
      expect(old.card.edges).toContainEqual({
        verb: "supersedes",
        to: "decision:te0820-uio-v2",
        meta: { reason: "replaced by v2", direction: "in" },
      });
    }),
  );
});
