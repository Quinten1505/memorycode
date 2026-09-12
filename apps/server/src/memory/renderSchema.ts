import {
  DEFAULT_STATUS,
  EDGE_ENDS,
  EDGE_VERBS,
  EXTRA_FIELDS,
  L3_TYPES,
  type EdgeVerb,
} from "./vocabulary.ts";

const NODE_TABLES = [
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

/** Spec §9: FTS + HNSW + scope/status/tags on every table with body + title. */
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

const INDEXED_TABLE_SET: ReadonlySet<string> = new Set(INDEXED_TABLES);
const FULL_SPINE_SET: ReadonlySet<string> = new Set([...L3_TYPES, "episode"]);

const STATUS_ENUMS: Readonly<Record<string, readonly string[]>> = {
  decision: ["proposed", "accepted", "superseded", "rejected"],
  constraint: ["proposed", "active", "relaxed", "obsolete"],
  convention: ["proposed", "active", "deprecated"],
  lesson: ["active", "superseded"],
  incident: ["open", "mitigated", "closed"],
  skill: ["draft", "active", "retired"],
  preference: ["proposed", "active", "withdrawn"],
  fact: ["asserted", "contradicted", "expired"],
  concept: ["active", "merged"],
  thought: ["inbox", "clustered", "promoted", "discarded"],
  schema_proposal: ["proposed", "accepted", "rejected", "shipped"],
  episode: ["open", "closed"],
  project: ["active", "archived"],
  repo: ["active", "archived"],
  component: ["active", "archived"],
  interface: ["active", "archived"],
  artifact: ["active", "archived"],
  symbol: ["active", "archived"],
  person: ["active", "archived"],
  vendor: ["active", "archived"],
  tool: ["active", "archived"],
  agent: ["active", "archived"],
  run: ["running", "ok", "error"],
};

const EXTRA_SQL: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  decision: { alternatives: "TYPE option<array<string>>" },
  constraint: {
    severity: `TYPE string ASSERT $value IN ["blocker", "high", "medium"]`,
    authority: "TYPE option<string>",
  },
  lesson: {
    kind: `TYPE string ASSERT $value IN ["practice", "anti-pattern", "gotcha"]`,
  },
  incident: {
    detected_at: "TYPE option<datetime>",
    resolved_at: "TYPE option<datetime>",
  },
  skill: {
    trigger: "TYPE string",
    steps: "TYPE array<string>",
    validate: "TYPE option<string>",
  },
  thought: {
    facet: "TYPE string",
    about: "TYPE option<array<string>>",
  },
  schema_proposal: {
    proposed_table: "TYPE string",
    proposed_kind: `TYPE string ASSERT $value IN ["node", "edge"]`,
    justification: "TYPE string",
    example_ids: "TYPE array<string>",
    suggested_fields: "TYPE option<array<string>>",
  },
  component: {
    kind: `TYPE string ASSERT $value IN ["software", "firmware", "fpga", "pcb", "mechanical", "service", "testbench", "other"]`,
    primary_path: "TYPE option<string>",
    primary_repo: "TYPE option<record<repo>>",
  },
  interface: {
    kind: `TYPE string ASSERT $value IN ["api", "abi", "bus", "pin", "schema", "cli", "rpc", "other"]`,
  },
  artifact: {
    uri: "TYPE string",
    media: "TYPE option<string>",
    content_hash: "TYPE option<string>",
  },
  symbol: {
    qualified_name: "TYPE string",
    language: "TYPE option<string>",
    path: "TYPE option<string>",
    repo: "TYPE option<record<repo>>",
  },
  repo: {
    full_name: "TYPE string",
    default_branch: `TYPE string DEFAULT "main"`,
    origin_url: "TYPE option<string>",
  },
  person: {
    kind: `TYPE string ASSERT $value IN ["operator", "collaborator", "vendor-contact", "other"]`,
    handles: "TYPE option<object> FLEXIBLE",
  },
  vendor: { url: "TYPE option<string>" },
  tool: {
    kind: `TYPE string ASSERT $value IN ["cli", "ide", "eda", "lab", "model", "service", "other"]`,
    current_version: "TYPE option<string>",
  },
  project: {
    root_path: "TYPE option<string>",
    default_repo: "TYPE option<record<repo>>",
  },
  episode: {
    started_at: "TYPE option<datetime>",
    ended_at: "TYPE option<datetime>",
  },
  agent: {
    kind: `TYPE string ASSERT $value IN ["human", "harness", "extractor", "promoter"]`,
    provider: "TYPE option<record<provider>>",
  },
};

const EDGE_EXTRA_SQL: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  promoted_to: { reason: "TYPE option<string>" },
  in_repo: {
    path: "TYPE option<string>",
    commit: "TYPE option<string>",
  },
  depends_on: {
    kind: `TYPE string ASSERT $value IN ["build", "runtime", "test", "docs"]`,
  },
  affects: {
    severity: `TYPE string ASSERT $value IN ["low", "medium", "high"] DEFAULT "medium"`,
  },
  supersedes: { reason: "TYPE string" },
  contradicts: { reason: "TYPE option<string>" },
  evidenced_by: {
    quote: "TYPE option<string>",
    loc: "TYPE option<string>",
  },
  uses_tool: { version: "TYPE option<string>" },
  owned_by: { role: "TYPE option<string>" },
  mentions: { quote: "TYPE option<string>" },
};

const TITLE_TYPE = "TYPE string ASSERT string::len($value) > 0 AND string::len($value) <= 200";
const CONFIDENCE_TYPE = "TYPE float ASSERT $value >= 0 AND $value <= 1 DEFAULT 0.6";

export function renderMemorySchema(opts: {
  embedDim: number;
  namespace?: string;
  database?: string;
}): string {
  const { embedDim, namespace = "harness", database = "memory" } = opts;
  return [
    renderNamespace(namespace, database),
    renderAnalyzer(),
    NODE_TABLES.map(renderNodeTable).join("\n\n"),
    renderSeeds(),
    EDGE_VERBS.map(renderEdgeTable).join("\n\n"),
    renderIndexes(embedDim),
  ].join("\n\n");
}

function renderNamespace(namespace: string, database: string): string {
  return [
    `DEFINE NAMESPACE OVERWRITE ${namespace};`,
    `USE NS ${namespace};`,
    `DEFINE DATABASE OVERWRITE ${database};`,
    `USE NS ${namespace} DB ${database};`,
  ].join("\n");
}

function renderAnalyzer(): string {
  return [
    "DEFINE ANALYZER OVERWRITE memory_en TOKENIZERS blank, class",
    "  FILTERS lowercase, snowball(english);",
  ].join("\n");
}

function renderNodeTable(table: string): string {
  const statements = [`DEFINE TABLE OVERWRITE ${table} SCHEMAFULL;`];
  if (table === "provider") {
    statements.push(field(table, "title", TITLE_TYPE));
    statements.push(field(table, "created_at", "TYPE datetime DEFAULT time::now() READONLY"));
    return statements.join("\n");
  }
  if (table === "run") {
    statements.push(field(table, "provider", "TYPE record<provider>"));
    statements.push(field(table, "agent", "TYPE record<agent>"));
    statements.push(field(table, "project", "TYPE option<record<project>>"));
    statements.push(field(table, "t3_thread_id", "TYPE option<string>"));
    statements.push(field(table, "t3_turn_id", "TYPE option<string>"));
    statements.push(field(table, "started_at", "TYPE option<datetime>"));
    statements.push(field(table, "ended_at", "TYPE option<datetime>"));
    statements.push(statusField(table, STATUS_ENUMS.run, "running"));
    statements.push(field(table, "created_at", "TYPE datetime DEFAULT time::now() READONLY"));
    statements.push(field(table, "updated_at", "TYPE datetime DEFAULT time::now()"));
    return statements.join("\n");
  }
  if (table === "observation") {
    statements.push(field(table, "title", TITLE_TYPE));
    statements.push(field(table, "body", `TYPE string DEFAULT ""`));
    statements.push(
      field(table, "kind", `TYPE string ASSERT $value IN ["note", "quote", "hypothesis"]`),
    );
    statements.push(field(table, "status", `TYPE string DEFAULT "open"`));
    statements.push(field(table, "confidence", CONFIDENCE_TYPE));
    statements.push(field(table, "scope", "TYPE set<string> DEFAULT <set>[]"));
    statements.push(field(table, "tags", "TYPE set<string> DEFAULT <set>[]"));
    statements.push(field(table, "embedding", "TYPE option<array<float>>"));
    statements.push(field(table, "created_at", "TYPE datetime DEFAULT time::now() READONLY"));
    statements.push(field(table, "updated_at", "TYPE datetime DEFAULT time::now()"));
    statements.push(field(table, "source_run", "TYPE option<record<run>>"));
    return statements.join("\n");
  }

  const kind = FULL_SPINE_SET.has(table) ? "full" : "topology";
  statements.push(...spineFields(table, kind));
  return statements.join("\n");
}

function spineFields(table: string, kind: "full" | "topology"): string[] {
  const indexed = INDEXED_TABLE_SET.has(table);
  const statements = [field(table, "title", TITLE_TYPE)];
  if (kind === "full" || indexed) {
    statements.push(field(table, "body", `TYPE string DEFAULT ""`));
  }
  const statuses = STATUS_ENUMS[table];
  if (statuses !== undefined) {
    statements.push(statusField(table, statuses, defaultStatus(table)));
  }
  if (kind === "full") {
    statements.push(field(table, "confidence", CONFIDENCE_TYPE));
  }
  statements.push(field(table, "scope", "TYPE set<string> DEFAULT <set>[]"));
  statements.push(field(table, "tags", "TYPE set<string> DEFAULT <set>[]"));
  if (kind === "full" || indexed) {
    statements.push(field(table, "embedding", "TYPE option<array<float>>"));
  }
  statements.push(...extraFields(table));
  statements.push(field(table, "created_at", "TYPE datetime DEFAULT time::now() READONLY"));
  statements.push(field(table, "updated_at", "TYPE datetime DEFAULT time::now()"));
  if (kind === "full") {
    statements.push(field(table, "valid_from", "TYPE option<datetime>"));
    statements.push(field(table, "valid_until", "TYPE option<datetime>"));
    statements.push(field(table, "authored_by", "TYPE record<agent | person>"));
    statements.push(field(table, "source_run", "TYPE option<record<run>>"));
  }
  return statements;
}

function extraFields(table: string): string[] {
  const extras = EXTRA_SQL[table] ?? {};
  const vocab = EXTRA_FIELDS[table as keyof typeof EXTRA_FIELDS];
  if (vocab !== undefined) {
    for (const key of vocab.keys) {
      if (extras[key] === undefined) {
        throw new Error(`missing Surreal type for extra field ${table}.${key}`);
      }
    }
  }
  return Object.entries(extras).map(([name, rest]) => field(table, name, rest));
}

function renderSeeds(): string {
  const providers = PROVIDERS.map(
    (slug) => `UPSERT provider:${slug} CONTENT { title: "${slug}" };`,
  );
  return [
    ...providers,
    `UPSERT agent:harness CONTENT { title: "harness", kind: "harness", status: "active", scope: <set>[], tags: <set>[] };`,
  ].join("\n");
}

function renderEdgeTable(verb: EdgeVerb): string {
  const ends = EDGE_ENDS[verb];
  const statements = [
    `DEFINE TABLE OVERWRITE ${verb} SCHEMAFULL TYPE RELATION IN ${ends.in.join(" | ")} OUT ${ends.out.join(" | ")};`,
    field(verb, "created_at", "TYPE datetime DEFAULT time::now() READONLY"),
    field(verb, "source_run", "TYPE option<record<run>>"),
    field(verb, "confidence", "TYPE option<float>"),
  ];
  const extras = EDGE_EXTRA_SQL[verb];
  if (extras !== undefined) {
    for (const [name, rest] of Object.entries(extras)) {
      statements.push(field(verb, name, rest));
    }
  }
  if (verb !== "mentions" && verb !== "evidenced_by") {
    statements.push(`DEFINE INDEX OVERWRITE ${verb}_pair ON ${verb} FIELDS in, out UNIQUE;`);
  }
  return statements.join("\n");
}

function renderIndexes(embedDim: number): string {
  const statements: string[] = [];
  for (const table of INDEXED_TABLES) {
    statements.push(
      `DEFINE INDEX OVERWRITE idx_body_fts ON ${table} FIELDS body FULLTEXT ANALYZER memory_en BM25 HIGHLIGHTS;`,
    );
    statements.push(
      `DEFINE INDEX OVERWRITE idx_title_fts ON ${table} FIELDS title FULLTEXT ANALYZER memory_en BM25;`,
    );
    statements.push(
      `DEFINE INDEX OVERWRITE idx_embedding ON ${table} FIELDS embedding HNSW DIMENSION ${embedDim} DIST COSINE TYPE F32;`,
    );
    statements.push(`DEFINE INDEX OVERWRITE idx_scope ON ${table} FIELDS scope;`);
    statements.push(`DEFINE INDEX OVERWRITE idx_status ON ${table} FIELDS status;`);
    statements.push(`DEFINE INDEX OVERWRITE idx_tags ON ${table} FIELDS tags;`);
  }
  statements.push("DEFINE INDEX OVERWRITE idx_facet ON thought FIELDS facet;");
  statements.push("DEFINE INDEX OVERWRITE idx_full_name ON repo FIELDS full_name UNIQUE;");
  return statements.join("\n");
}

function statusField(table: string, values: readonly string[], fallback?: string): string {
  const quoted = values.map((value) => `"${value}"`).join(", ");
  const defaultSql = fallback !== undefined ? ` DEFAULT "${fallback}"` : "";
  return field(table, "status", `TYPE string ASSERT $value IN [${quoted}]${defaultSql}`);
}

function defaultStatus(table: string): string | undefined {
  if (table in DEFAULT_STATUS) {
    return DEFAULT_STATUS[table as keyof typeof DEFAULT_STATUS];
  }
  if (table === "agent") {
    return "active";
  }
  return undefined;
}

function field(table: string, name: string, rest: string): string {
  return `DEFINE FIELD OVERWRITE ${name} ON ${table} ${rest};`;
}
