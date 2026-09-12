import { describe, expect, it } from "@effect/vitest";

import { assertSlug, composeRecordId, parseRecordId } from "./ids.ts";

describe("ids", () => {
  it("composes type:slug", () => {
    expect(composeRecordId("decision", "te0820-uio-not-mmap")).toBe("decision:te0820-uio-not-mmap");
  });
  it("rejects empty, uppercase, underscore, and overlong slugs", () => {
    expect(() => assertSlug("")).toThrow();
    expect(() => assertSlug("UIO")).toThrow();
    expect(() => assertSlug("uio_map")).toThrow();
    expect(() => assertSlug("a".repeat(81))).toThrow();
  });
  it("parses a record id", () => {
    expect(parseRecordId("thought:open-question-uio")).toEqual({
      type: "thought",
      slug: "open-question-uio",
    });
  });
});
