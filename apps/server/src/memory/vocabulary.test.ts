import { describe, expect, it } from "@effect/vitest";

import { DEFAULT_STATUS, EDGE_VERBS, LIVE_STATUSES, REMEMBER_TYPES } from "./vocabulary.ts";

describe("vocabulary", () => {
  it("includes the closed remember types from the ontology", () => {
    const expected = [
      "decision",
      "constraint",
      "convention",
      "lesson",
      "incident",
      "skill",
      "preference",
      "fact",
      "concept",
      "thought",
      "schema_proposal",
      "component",
      "interface",
      "episode",
      "artifact",
      "person",
      "vendor",
      "tool",
      "project",
      "repo",
      "symbol",
    ] as const;

    for (const type of expected) {
      expect(REMEMBER_TYPES).toContain(type);
    }
    expect(REMEMBER_TYPES).toHaveLength(expected.length);
  });

  it("includes the closed edge verbs from the ontology", () => {
    const expected = [
      "in_project",
      "promoted_to",
      "motivated",
      "about",
      "in_repo",
      "implements",
      "depends_on",
      "affects",
      "constrains",
      "supersedes",
      "contradicts",
      "learned_in",
      "uses_tool",
      "owned_by",
      "tagged",
      "mentions",
      "occurred_in",
      "evidenced_by",
    ] as const;

    for (const verb of expected) {
      expect(EDGE_VERBS).toContain(verb);
    }
    expect(EDGE_VERBS).toHaveLength(expected.length);
  });

  it("maps default create statuses from the ontology", () => {
    expect(DEFAULT_STATUS.decision).toBe("proposed");
    expect(DEFAULT_STATUS.constraint).toBe("proposed");
    expect(DEFAULT_STATUS.convention).toBe("proposed");
    expect(DEFAULT_STATUS.preference).toBe("proposed");
    expect(DEFAULT_STATUS.schema_proposal).toBe("proposed");
    expect(DEFAULT_STATUS.lesson).toBe("active");
    expect(DEFAULT_STATUS.incident).toBe("open");
    expect(DEFAULT_STATUS.skill).toBe("draft");
    expect(DEFAULT_STATUS.fact).toBe("asserted");
    expect(DEFAULT_STATUS.concept).toBe("active");
    expect(DEFAULT_STATUS.thought).toBe("inbox");
    expect(DEFAULT_STATUS.episode).toBe("open");
    expect(DEFAULT_STATUS.component).toBe("active");
    expect(DEFAULT_STATUS.interface).toBe("active");
    expect(DEFAULT_STATUS.project).toBe("active");
  });

  it("maps live statuses from the ontology table", () => {
    expect(LIVE_STATUSES.decision).toEqual(["proposed", "accepted"]);
    expect(LIVE_STATUSES.constraint).toEqual(["proposed", "active"]);
    expect(LIVE_STATUSES.convention).toEqual(["proposed", "active"]);
    expect(LIVE_STATUSES.lesson).toEqual(["active"]);
    expect(LIVE_STATUSES.incident).toEqual(["open", "mitigated"]);
    expect(LIVE_STATUSES.skill).toEqual(["draft", "active"]);
    expect(LIVE_STATUSES.preference).toEqual(["proposed", "active"]);
    expect(LIVE_STATUSES.fact).toEqual(["asserted"]);
    expect(LIVE_STATUSES.concept).toEqual(["active"]);
    expect(LIVE_STATUSES.thought).toEqual(["inbox", "clustered"]);
    expect(LIVE_STATUSES.schema_proposal).toEqual(["proposed", "accepted"]);
    expect(LIVE_STATUSES.episode).toEqual(["open"]);
    expect(LIVE_STATUSES.project).toEqual(["active"]);
  });
});
