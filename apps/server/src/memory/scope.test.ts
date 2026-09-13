import { describe, expect, it } from "@effect/vitest";

import { scopeMatches } from "./scope.ts";

describe("scope", () => {
  it("matches project or _global unless include_global is false", () => {
    expect(scopeMatches(["project:te0820-hil", "domain:hw"], { project: "te0820-hil" })).toBe(true);
    expect(scopeMatches(["project:_global"], { project: "te0820-hil" })).toBe(true);
    expect(scopeMatches(["project:_global"], { project: "te0820-hil", includeGlobal: false })).toBe(
      false,
    );
  });
});
