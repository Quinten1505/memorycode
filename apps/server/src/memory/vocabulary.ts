/** L3 knowledge types (ontology §7.3), excluding thought / schema_proposal. */
export const KNOWLEDGE_TYPES = [
  "decision",
  "constraint",
  "convention",
  "lesson",
  "incident",
  "skill",
  "preference",
  "fact",
  "concept",
] as const;
export type KnowledgeType = (typeof KNOWLEDGE_TYPES)[number];

/** Types accepted by memory_remember (ontology §7 + brief). */
export const REMEMBER_TYPES = [
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
export type RememberType = (typeof REMEMBER_TYPES)[number];

export const TOPOLOGY_TYPES = [
  "project",
  "repo",
  "component",
  "interface",
  "artifact",
  "symbol",
] as const;
export type TopologyType = (typeof TOPOLOGY_TYPES)[number];

const TOPOLOGY_EXCEPT_PROJECT = ["repo", "component", "interface", "artifact", "symbol"] as const;

/** All L3 types including inbox / proposal (ontology §7.3). */
export const L3_TYPES = [...KNOWLEDGE_TYPES, "thought", "schema_proposal"] as const;
export type L3Type = (typeof L3_TYPES)[number];

/** Node types that appear as edge endpoints (ontology §7–§8). */
export const NODE_TYPES = [...REMEMBER_TYPES, "observation", "run", "provider", "agent"] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const EDGE_VERBS = [
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
export type EdgeVerb = (typeof EDGE_VERBS)[number];

/** IN/OUT unions per verb (ontology §8). Same-type checks for supersedes are deferred to link time. */
export const EDGE_ENDS = {
  in_project: {
    in: [...KNOWLEDGE_TYPES, "thought", "schema_proposal", ...TOPOLOGY_EXCEPT_PROJECT],
    out: ["project"],
  },
  promoted_to: {
    in: ["thought"],
    out: [...KNOWLEDGE_TYPES],
  },
  motivated: {
    in: ["schema_proposal"],
    out: ["thought", "concept"],
  },
  about: {
    in: ["thought", "concept"],
    out: [...NODE_TYPES],
  },
  in_repo: {
    in: ["component", "artifact", "symbol", "interface"],
    out: ["repo"],
  },
  implements: {
    in: ["component"],
    out: ["interface"],
  },
  depends_on: {
    in: ["component"],
    out: ["component"],
  },
  affects: {
    in: ["decision", "constraint", "lesson", "incident", "convention"],
    out: ["component", "interface", "project"],
  },
  constrains: {
    in: ["constraint"],
    out: ["component", "interface", "project", "skill"],
  },
  supersedes: {
    in: [...KNOWLEDGE_TYPES],
    out: [...KNOWLEDGE_TYPES],
  },
  contradicts: {
    in: ["fact", "lesson", "decision"],
    out: ["fact", "decision", "constraint"],
  },
  learned_in: {
    in: ["lesson", "decision", "constraint", "skill"],
    out: ["episode", "incident", "run"],
  },
  uses_tool: {
    in: ["episode", "skill", "incident", "run"],
    out: ["tool"],
  },
  owned_by: {
    in: ["component", "project", "artifact"],
    out: ["person"],
  },
  tagged: {
    in: [...L3_TYPES],
    out: ["concept"],
  },
  mentions: {
    in: ["observation", "run"],
    out: [...NODE_TYPES],
  },
  occurred_in: {
    in: ["incident"],
    out: ["episode", "project"],
  },
  evidenced_by: {
    in: [...KNOWLEDGE_TYPES],
    out: ["artifact", "symbol", "run"],
  },
} as const satisfies Record<
  EdgeVerb,
  { readonly in: readonly string[]; readonly out: readonly string[] }
>;

/** Default status on create (ontology §10.3). */
export const DEFAULT_STATUS = {
  decision: "proposed",
  constraint: "proposed",
  convention: "proposed",
  preference: "proposed",
  schema_proposal: "proposed",
  lesson: "active",
  incident: "open",
  skill: "draft",
  fact: "asserted",
  concept: "active",
  thought: "inbox",
  episode: "open",
  component: "active",
  interface: "active",
  artifact: "active",
  person: "active",
  vendor: "active",
  tool: "active",
  project: "active",
  repo: "active",
  symbol: "active",
} as const satisfies Record<RememberType, string>;
export type DefaultStatus = (typeof DEFAULT_STATUS)[RememberType];

/** Live statuses for recall/bootstrap filters (ontology §9). */
export const LIVE_STATUSES = {
  decision: ["proposed", "accepted"],
  constraint: ["proposed", "active"],
  convention: ["proposed", "active"],
  lesson: ["active"],
  incident: ["open", "mitigated"],
  skill: ["draft", "active"],
  preference: ["proposed", "active"],
  fact: ["asserted"],
  concept: ["active"],
  thought: ["inbox", "clustered"],
  schema_proposal: ["proposed", "accepted"],
  episode: ["open"],
  project: ["active"],
} as const;

export type ExtraFieldSpec = {
  readonly keys: readonly string[];
  readonly required?: readonly string[];
  readonly enums?: Readonly<Record<string, readonly string[]>>;
};

/** Allowed `extra` keys per remember type (ontology §7 + brief). */
export const EXTRA_FIELDS = {
  decision: { keys: ["alternatives"] },
  constraint: {
    keys: ["severity", "authority"],
    required: ["severity"],
    enums: { severity: ["blocker", "high", "medium"] },
  },
  lesson: {
    keys: ["kind"],
    required: ["kind"],
    enums: { kind: ["practice", "anti-pattern", "gotcha"] },
  },
  incident: { keys: ["detected_at", "resolved_at"] },
  skill: {
    keys: ["trigger", "steps", "validate"],
    required: ["trigger", "steps"],
  },
  thought: {
    keys: ["facet", "about"],
    required: ["facet"],
  },
  schema_proposal: {
    keys: ["proposed_table", "proposed_kind", "justification", "example_ids", "suggested_fields"],
    required: ["proposed_table", "proposed_kind", "justification", "example_ids"],
    enums: { proposed_kind: ["node", "edge"] },
  },
  component: {
    keys: ["kind", "primary_path"],
    required: ["kind"],
    enums: {
      kind: ["software", "firmware", "fpga", "pcb", "mechanical", "service", "testbench", "other"],
    },
  },
  interface: {
    keys: ["kind"],
    required: ["kind"],
    enums: { kind: ["api", "abi", "bus", "pin", "schema", "cli", "rpc", "other"] },
  },
  artifact: {
    keys: ["uri", "media", "content_hash"],
    required: ["uri"],
  },
  symbol: {
    keys: ["qualified_name", "language", "path"],
    required: ["qualified_name"],
  },
  repo: {
    keys: ["full_name", "default_branch", "origin_url"],
    required: ["full_name"],
  },
  person: {
    keys: ["kind", "handles"],
    required: ["kind"],
    enums: { kind: ["operator", "collaborator", "vendor-contact", "other"] },
  },
  vendor: { keys: ["url"] },
  tool: {
    keys: ["kind", "current_version"],
    required: ["kind"],
    enums: { kind: ["cli", "ide", "eda", "lab", "model", "service", "other"] },
  },
  project: { keys: ["root_path"] },
  episode: { keys: ["started_at", "ended_at"] },
} as const satisfies Readonly<Partial<Record<RememberType, ExtraFieldSpec>>>;

export const SCOPE_KEYS = ["project", "repo", "domain", "sensitivity"] as const;
export type ScopeKey = (typeof SCOPE_KEYS)[number];

export const REMEMBER_TYPE_SET: ReadonlySet<string> = new Set(REMEMBER_TYPES);
export const EDGE_VERB_SET: ReadonlySet<string> = new Set(EDGE_VERBS);
export const KNOWLEDGE_TYPE_SET: ReadonlySet<string> = new Set(KNOWLEDGE_TYPES);
