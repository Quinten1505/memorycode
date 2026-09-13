import { describe, expect, it } from "@effect/vitest";

import { renderMemorySchema } from "./renderSchema.ts";
import { EDGE_ENDS, EDGE_VERBS, EXTRA_FIELDS } from "./vocabulary.ts";

const TABLES = [
  "provider",
  "agent",
  "run",
  "project",
  "repo",
  "component",
  "interface",
  "artifact",
  "symbol",
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
  "person",
  "vendor",
  "tool",
  "observation",
  "episode",
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
  "evidenced_by",
  "uses_tool",
  "owned_by",
  "tagged",
  "mentions",
  "occurred_in",
] as const;

const INDEXED_TABLES = [
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
  "observation",
] as const;

const PROVIDERS = [
  "codex",
  "claude",
  "cursor",
  "grok",
  "opencode",
  "antigravity",
  "other",
] as const;

describe("renderMemorySchema", () => {
  it("emits DEFINE TABLE OVERWRITE for every closed type and edge", () => {
    const sql = renderMemorySchema({ embedDim: 1536 });
    for (const table of [
      "provider",
      "agent",
      "run",
      "project",
      "repo",
      "component",
      "interface",
      "artifact",
      "symbol",
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
      "person",
      "vendor",
      "tool",
      "observation",
      "episode",
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
      "evidenced_by",
      "uses_tool",
      "owned_by",
      "tagged",
      "mentions",
      "occurred_in",
    ]) {
      expect(sql).toContain(`DEFINE TABLE OVERWRITE ${table}`);
    }
    expect(sql).toContain("HNSW DIMENSION 1536");
    expect(sql).toContain("DEFINE ANALYZER OVERWRITE memory_en");
    expect(sql).toContain("DEFINE NAMESPACE OVERWRITE harness");
    expect(sql).toContain("DEFINE DATABASE OVERWRITE memory");
  });

  it("uses the configured namespace and database", () => {
    const sql = renderMemorySchema({ embedDim: 1536, namespace: "team", database: "kb" });
    expect(sql).toContain("DEFINE NAMESPACE OVERWRITE team");
    expect(sql).toContain("USE NS team;");
    expect(sql).toContain("DEFINE DATABASE OVERWRITE kb");
    expect(sql).toContain("USE NS team DB kb");
    expect(sql).not.toContain("DEFINE NAMESPACE OVERWRITE harness");
    expect(sql).not.toContain("DEFINE DATABASE OVERWRITE memory");
  });

  it("emits namespace, analyzer, tables, seeds, and indexes in order", () => {
    const sql = renderMemorySchema({ embedDim: 768 });
    const ns = sql.indexOf("DEFINE NAMESPACE OVERWRITE harness");
    const useNs = sql.indexOf("USE NS harness");
    const db = sql.indexOf("DEFINE DATABASE OVERWRITE memory");
    const useDb = sql.indexOf("USE NS harness DB memory");
    const analyzer = sql.indexOf("DEFINE ANALYZER OVERWRITE memory_en");
    const firstTable = sql.indexOf("DEFINE TABLE OVERWRITE provider");
    const seedProvider = sql.indexOf("UPSERT provider:codex");
    const seedAgent = sql.indexOf("UPSERT agent:harness");
    const firstEdge = sql.indexOf("DEFINE TABLE OVERWRITE in_project");
    const hnsw = sql.indexOf("HNSW DIMENSION 768");

    expect(ns).toBeGreaterThanOrEqual(0);
    expect(useNs).toBeGreaterThan(ns);
    expect(db).toBeGreaterThan(useNs);
    expect(useDb).toBeGreaterThan(db);
    expect(analyzer).toBeGreaterThan(useDb);
    expect(firstTable).toBeGreaterThan(analyzer);
    expect(seedProvider).toBeGreaterThan(firstTable);
    expect(seedAgent).toBeGreaterThan(seedProvider);
    expect(firstEdge).toBeGreaterThan(seedAgent);
    expect(hnsw).toBeGreaterThan(firstEdge);

    expect(sql).toContain("TOKENIZERS blank, class");
    expect(sql).toContain("FILTERS lowercase, snowball(english)");
  });

  it("defines SCHEMAFULL nodes with spine, extras, and FLEXIBLE handles", () => {
    const sql = renderMemorySchema({ embedDim: 1536 });

    for (const table of TABLES) {
      if (table in EDGE_ENDS) {
        expect(sql).toContain(`DEFINE TABLE OVERWRITE ${table} SCHEMAFULL TYPE RELATION`);
      } else {
        expect(sql).toContain(`DEFINE TABLE OVERWRITE ${table} SCHEMAFULL`);
      }
    }

    expect(sql).toContain(
      `DEFINE FIELD OVERWRITE title ON decision TYPE string ASSERT string::len($value) > 0 AND string::len($value) <= 200`,
    );
    expect(sql).toContain('DEFINE FIELD OVERWRITE body ON decision TYPE string DEFAULT ""');
    expect(sql).toContain(`ASSERT $value IN ["proposed", "accepted", "superseded", "rejected"]`);
    expect(sql).toContain(
      `DEFINE FIELD OVERWRITE confidence ON decision TYPE float ASSERT $value >= 0 AND $value <= 1 DEFAULT 0.6`,
    );
    expect(sql).toContain(
      "DEFINE FIELD OVERWRITE created_at ON decision TYPE datetime DEFAULT time::now() READONLY",
    );
    expect(sql).toContain(
      "DEFINE FIELD OVERWRITE authored_by ON decision TYPE record<agent | person>",
    );
    expect(sql).toContain("DEFINE FIELD OVERWRITE source_run ON decision TYPE option<record<run>>");
    expect(sql).toContain("DEFINE FIELD OVERWRITE valid_from ON decision TYPE option<datetime>");
    expect(sql).toContain("DEFINE FIELD OVERWRITE embedding ON decision TYPE option<array<float>>");

    expect(sql).not.toContain("DEFINE FIELD OVERWRITE body ON project");
    expect(sql).not.toContain("DEFINE FIELD OVERWRITE embedding ON project");
    expect(sql).not.toContain("DEFINE FIELD OVERWRITE confidence ON project");
    expect(sql).toContain("DEFINE FIELD OVERWRITE title ON project");
    expect(sql).toContain("DEFINE FIELD OVERWRITE status ON project");
    expect(sql).toContain("DEFINE FIELD OVERWRITE scope ON project");
    expect(sql).toContain("DEFINE FIELD OVERWRITE tags ON project");

    expect(sql).toContain("DEFINE FIELD OVERWRITE body ON component");
    expect(sql).toContain("DEFINE FIELD OVERWRITE embedding ON component");

    expect(sql).toContain("DEFINE FIELD OVERWRITE handles ON person TYPE option<object> FLEXIBLE");

    for (const [type, spec] of Object.entries(EXTRA_FIELDS)) {
      for (const key of spec.keys) {
        expect(sql).toContain(`DEFINE FIELD OVERWRITE ${key} ON ${type}`);
      }
    }

    expect(sql).toContain("DEFINE FIELD OVERWRITE created_at ON");
    expect(sql).toMatch(
      /DEFINE FIELD OVERWRITE status ON decision TYPE string[\s\S]*DEFAULT "proposed"/,
    );
  });

  it("seeds providers and agent:harness after node tables exist", () => {
    const sql = renderMemorySchema({ embedDim: 1536 });
    for (const slug of PROVIDERS) {
      expect(sql).toContain(`UPSERT provider:${slug} SET title`);
    }
    expect(sql).toContain("UPSERT agent:harness SET");
    expect(sql).toContain('kind = "harness"');
  });

  it("defines edge IN/OUT unions, shared fields, and UNIQUE (in,out) except mentions and evidenced_by", () => {
    const sql = renderMemorySchema({ embedDim: 1536 });

    for (const verb of EDGE_VERBS) {
      const ends = EDGE_ENDS[verb];
      expect(sql).toContain(`IN ${ends.in.join(" | ")}`);
      expect(sql).toContain(`OUT ${ends.out.join(" | ")}`);
      expect(sql).toContain(
        `DEFINE FIELD OVERWRITE created_at ON ${verb} TYPE datetime DEFAULT time::now() READONLY`,
      );
      expect(sql).toContain(
        `DEFINE FIELD OVERWRITE source_run ON ${verb} TYPE option<record<run>>`,
      );
      expect(sql).toContain(`DEFINE FIELD OVERWRITE confidence ON ${verb} TYPE option<float>`);

      if (verb === "mentions" || verb === "evidenced_by") {
        expect(sql).not.toMatch(new RegExp(`ON ${verb} FIELDS in, out UNIQUE`));
      } else {
        expect(sql).toMatch(new RegExp(`ON ${verb} FIELDS in, out UNIQUE`));
      }
    }

    expect(sql).toContain(`DEFINE FIELD OVERWRITE severity ON affects TYPE string`);
    expect(sql).toContain(`ASSERT $value IN ["low", "medium", "high"] DEFAULT "medium"`);
  });

  it("indexes FTS, HNSW, scope, status, tags, and thought.facet", () => {
    const sql = renderMemorySchema({ embedDim: 1536 });

    for (const table of INDEXED_TABLES) {
      expect(sql).toContain(
        `DEFINE INDEX OVERWRITE idx_body_fts ON ${table} FIELDS body FULLTEXT ANALYZER memory_en BM25 HIGHLIGHTS`,
      );
      expect(sql).toContain(
        `DEFINE INDEX OVERWRITE idx_title_fts ON ${table} FIELDS title FULLTEXT ANALYZER memory_en BM25`,
      );
      expect(sql).toContain(
        `DEFINE INDEX OVERWRITE idx_embedding ON ${table} FIELDS embedding HNSW DIMENSION 1536 DIST COSINE TYPE F32`,
      );
      expect(sql).toContain(`DEFINE INDEX OVERWRITE idx_scope ON ${table} FIELDS scope`);
      expect(sql).toContain(`DEFINE INDEX OVERWRITE idx_status ON ${table} FIELDS status`);
      expect(sql).toContain(`DEFINE INDEX OVERWRITE idx_tags ON ${table} FIELDS tags`);
    }

    expect(sql).toContain("DEFINE INDEX OVERWRITE idx_facet ON thought FIELDS facet");
    expect(sql).not.toContain("DEFINE INDEX OVERWRITE idx_body_fts ON project");
  });
});
