import { describe, expect, it } from "@effect/vitest";

import { canTransition } from "./transitions.ts";

describe("transitions", () => {
  it("allows proposed → accepted on decision", () => {
    expect(canTransition("decision", "proposed", "accepted", { confirm: false })).toBe(true);
  });
  it("requires successor for accepted → superseded", () => {
    expect(canTransition("decision", "accepted", "superseded", { confirm: false })).toBe(false);
    expect(
      canTransition("decision", "accepted", "superseded", {
        confirm: false,
        successor: "decision:next",
      }),
    ).toBe(true);
  });
  it("blocks constraint proposed → active without confirm", () => {
    expect(canTransition("constraint", "proposed", "active", { confirm: false })).toBe(false);
    expect(canTransition("constraint", "proposed", "active", { confirm: true })).toBe(true);
  });
});
