import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { makeInMemoryMemoryStore } from "./InMemoryMemoryStore.ts";
import {
  extractObservations,
  extractPromotions,
  kebabSlug,
  runSlugForTurn,
  titlesMatch,
} from "./ingestTurn.ts";

describe("ingestTurn extractors", () => {
  it("kebabs titles and turn ids", () => {
    expect(kebabSlug("New bitstream/XSA requires BOOT.BIN")).toBe(
      "new-bitstream-xsa-requires-boot-bin",
    );
    expect(runSlugForTurn("703584fd-1042-481a-8f9b-e3c9f141eea9")).toBe(
      "t-703584fd-1042-481a-8f9b-e3c9f141eea9",
    );
  });

  it("writes observations from user and assistant text, skips short and other turns", () => {
    const drafts = extractObservations(
      [
        {
          role: "user",
          turnId: "turn-1",
          text: "Please remember this important constraint about QSPI BOOT.BIN layout.",
        },
        { role: "assistant", turnId: "turn-1", text: "ok" },
        {
          role: "assistant",
          turnId: "turn-1",
          text: "Constraint: New bitstream requires a new QSPI BOOT.BIN.\nWe should rebuild image.ub too.",
        },
        {
          role: "user",
          turnId: "turn-2",
          text: "This is a different turn with plenty of characters.",
        },
      ],
      "turn-1",
    );
    expect(drafts).toHaveLength(2);
    expect(drafts[0]?.kind).toBe("quote");
    expect(drafts[1]?.kind).toBe("note");
    expect(drafts[1]?.body).toContain("BOOT.BIN");
  });

  it("promotes only labeled closed types and never invents tables", () => {
    const drafts = extractPromotions(`
Some chatter.

Constraint: New bitstream/XSA requires a new QSPI BOOT.BIN
Decision: Keep BOOT.BIN in the sibling bootloader repo
Wiki: do not create this
Lesson: RAUC does not update BOOT.BIN
`);
    expect(drafts.map((draft) => draft.type)).toEqual(["constraint", "decision", "lesson"]);
    expect(drafts[0]?.extra).toEqual({ severity: "medium" });
    expect(drafts[0]?.slug).toBe("new-bitstream-xsa-requires-a-new-qspi-boot-bin");
  });

  it("matches titles fuzzily", () => {
    expect(titlesMatch("New bitstream requires BOOT.BIN", "new bitstream requires boot.bin")).toBe(
      true,
    );
    expect(titlesMatch("UIO map", "RAUC bundle")).toBe(false);
  });
});

describe("InMemoryMemoryStore.ingestTurn", () => {
  it.effect("writes observations and promotes labeled knowledge without confirm", () =>
    Effect.gen(function* () {
      const store = makeInMemoryMemoryStore();
      const result = yield* store.ingestTurn({
        threadId: "thread-1",
        turnId: "turn-1",
        projectSlug: "petalinux_build",
        provider: "grok",
        messages: [
          {
            role: "user",
            turnId: "turn-1",
            text: "Remember: a new XSA means we must rebuild QSPI BOOT.BIN.",
          },
          {
            role: "assistant",
            turnId: "turn-1",
            text: "Constraint: New bitstream/XSA requires a new QSPI BOOT.BIN\nDecision: Keep BOOT.BIN in the sibling bootloader repo",
          },
        ],
      });
      expect(result.observationIds.length).toBe(2);
      expect(result.promotedIds).toContain(
        "constraint:new-bitstream-xsa-requires-a-new-qspi-boot-bin",
      );
      const constraint = yield* store.get({
        id: "constraint:new-bitstream-xsa-requires-a-new-qspi-boot-bin",
      });
      expect(constraint.card.status).toBe("proposed");
      expect(constraint.card.scope).toContain("project:petalinux_build");
    }),
  );

  it.effect("skips promotion when a live card already has the same title", () =>
    Effect.gen(function* () {
      const store = makeInMemoryMemoryStore();
      yield* store.remember({
        type: "constraint",
        slug: "bootbin",
        title: "New bitstream/XSA requires a new QSPI BOOT.BIN",
        scope: ["project:petalinux_build"],
        extra: { severity: "high" },
      });
      const result = yield* store.ingestTurn({
        threadId: "thread-1",
        turnId: "turn-2",
        projectSlug: "petalinux_build",
        provider: "grok",
        messages: [
          {
            role: "assistant",
            turnId: "turn-2",
            text: "Constraint: New bitstream/XSA requires a new QSPI BOOT.BIN",
          },
        ],
      });
      expect(result.promotedIds).toEqual([]);
    }),
  );
});
