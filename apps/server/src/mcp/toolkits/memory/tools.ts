import { McpCapabilityUnavailableError } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Tool from "effect/unstable/ai/Tool";
import * as Toolkit from "effect/unstable/ai/Toolkit";

import { MemoryService } from "../../../memory/MemoryService.ts";
import { EDGE_VERBS, REMEMBER_TYPES } from "../../../memory/vocabulary.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  MemoryService,
  ProjectionSnapshotQuery.ProjectionSnapshotQuery,
];

const CLOSED_TYPES = REMEMBER_TYPES.join(", ");
const CLOSED_VERBS = EDGE_VERBS.join(", ");

const MemoryJsonObject = Schema.Record(Schema.String, Schema.Unknown);

export const MemoryErrorCode = Schema.Literals([
  "not_found",
  "unknown_type",
  "unknown_verb",
  "invalid_slug",
  "invalid_transition",
  "successor_required",
  "confirm_required",
  "immutable_live_body",
  "type_mismatch",
  "scope_required",
  "not_a_thought",
  "already_promoted",
  "backend_unavailable",
]);

export const MemoryErrorResult = Schema.Struct({
  error: MemoryErrorCode,
  hint: Schema.optional(Schema.String),
});
export type MemoryErrorResult = typeof MemoryErrorResult.Type;

const MemoryEdge = Schema.Struct({
  verb: Schema.String,
  to: Schema.String,
  meta: Schema.optional(MemoryJsonObject),
});

export const MemoryCardSchema = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  title: Schema.String,
  body: Schema.String,
  status: Schema.String,
  confidence: Schema.Number,
  scope: Schema.Array(Schema.String),
  tags: Schema.Array(Schema.String),
  edges: Schema.Array(MemoryEdge),
  evidence: Schema.Array(
    Schema.Struct({
      to: Schema.String,
      quote: Schema.NullOr(Schema.String),
    }),
  ),
});
export type MemoryCardSchema = typeof MemoryCardSchema.Type;

export const MemoryCardResult = Schema.Struct({
  card: MemoryCardSchema,
});
export type MemoryCardResult = typeof MemoryCardResult.Type;

export const MemoryCardOrError = Schema.Union([MemoryCardResult, MemoryErrorResult]);

const MemoryLink = Schema.Struct({
  verb: Schema.Literals(EDGE_VERBS),
  to: Schema.String,
  meta: Schema.optional(MemoryJsonObject),
});

const RememberTypeSchema = Schema.Literals(REMEMBER_TYPES);

const MemoryBootstrapResult = Schema.Struct({
  project: Schema.optional(MemoryCardSchema),
  constraints: Schema.Array(MemoryCardSchema),
  conventions: Schema.Array(MemoryCardSchema),
  preferences: Schema.Array(MemoryCardSchema),
  open_incidents: Schema.Array(MemoryCardSchema),
  recent_lessons: Schema.Array(MemoryCardSchema),
  inbox: Schema.optional(Schema.Array(MemoryCardSchema)),
  tokens_est: Schema.Number,
});

const MemoryRecallResult = Schema.Struct({
  cards: Schema.Array(MemoryCardSchema),
  tokens_est: Schema.Number,
});

const MemoryLinkOk = Schema.Struct({
  ok: Schema.Literal(true),
});

const MemoryBootstrapTool = Tool.make("memory_bootstrap", {
  description: `Load live harness memory for a project: the project card, constraints, conventions, preferences, open incidents, and recent lessons. Call at the start of project work. Omit project to use this thread's workspace directory name (lowercased basename). Set include_inbox to include inbox thoughts. Closed types: ${CLOSED_TYPES}. Closed edge verbs: ${CLOSED_VERBS}. Never invent types or verbs.`,
  parameters: Schema.Struct({
    project: Schema.optional(
      Schema.String.annotate({
        description:
          "Project slug. Defaults to the lowercase basename of this thread's workspace root.",
      }),
    ),
    max_tokens: Schema.optional(
      Schema.Number.annotate({
        description: "Token budget for the returned cards. Defaults to 2000.",
      }),
    ),
    include_inbox: Schema.optional(
      Schema.Boolean.annotate({
        description: "When true, include up to five inbox thoughts.",
      }),
    ),
  }),
  success: Schema.Union([MemoryBootstrapResult, MemoryErrorResult]),
  failure: McpCapabilityUnavailableError,
  dependencies,
})
  .annotate(Tool.Title, "Bootstrap project memory")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const MemoryRecallTool = Tool.make("memory_recall", {
  description: `Search live harness memory by query. Default types are L3 knowledge plus thought. Closed types: ${CLOSED_TYPES}. Never invent types.`,
  parameters: Schema.Struct({
    query: Schema.String.annotate({ description: "Full-text query over title and body." }),
    project: Schema.optional(
      Schema.String.annotate({ description: "Limit to this project slug and project:_global." }),
    ),
    types: Schema.optional(
      Schema.Array(Schema.String).annotate({
        description: `Closed types to search. Closed types: ${CLOSED_TYPES}.`,
      }),
    ),
    k: Schema.optional(
      Schema.Number.annotate({ description: "Max cards to return. Default 8, max 20." }),
    ),
    include_proposed: Schema.optional(
      Schema.Boolean.annotate({
        description: "When true, include proposed/draft statuses that are otherwise filtered.",
      }),
    ),
  }),
  success: Schema.Union([MemoryRecallResult, MemoryErrorResult]),
  failure: McpCapabilityUnavailableError,
  dependencies,
})
  .annotate(Tool.Title, "Recall memory cards")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const MemoryGetTool = Tool.make("memory_get", {
  description:
    "Fetch one memory card by id (`type:slug`), including non-live and superseded records and both directions of supersedes.",
  parameters: Schema.Struct({
    id: Schema.String.annotate({
      description: "Record id, for example decision:te0820-uio-not-mmap.",
    }),
  }),
  success: MemoryCardOrError,
  failure: McpCapabilityUnavailableError,
  dependencies,
})
  .annotate(Tool.Title, "Get memory card")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const MemoryRememberTool = Tool.make("memory_remember", {
  description: `Create or patch a memory card. If nothing closed fits, write type=thought with extra.facet rather than inventing a table. Closed types: ${CLOSED_TYPES}. Closed edge verbs for links: ${CLOSED_VERBS}. Pass confirm=true only when the caller is explicitly confirming a constraint or preference.`,
  parameters: Schema.Struct({
    type: RememberTypeSchema.annotate({
      description: `Closed type. One of: ${CLOSED_TYPES}.`,
    }),
    slug: Schema.String.annotate({
      description: "Kebab-case slug; the record id is type:slug.",
    }),
    title: Schema.String.annotate({ description: "Short title." }),
    body: Schema.optional(Schema.String.annotate({ description: "Body text." })),
    scope: Schema.Array(Schema.String).annotate({
      description: "Scope tokens such as project:te0820-hil or domain:hw.",
    }),
    tags: Schema.optional(Schema.Array(Schema.String)),
    extra: Schema.optional(
      MemoryJsonObject.annotate({
        description: "Type-specific fields. Unknown keys are rejected.",
      }),
    ),
    links: Schema.optional(
      Schema.Array(MemoryLink).annotate({
        description: `Edges to create. verb must be one of: ${CLOSED_VERBS}.`,
      }),
    ),
    confirm: Schema.optional(
      Schema.Boolean.annotate({
        description: "Required to activate a constraint or preference. Never set automatically.",
      }),
    ),
  }),
  success: MemoryCardOrError,
  failure: McpCapabilityUnavailableError,
  dependencies,
})
  .annotate(Tool.Title, "Remember a card")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const MemoryLinkTool = Tool.make("memory_link", {
  description: `Create an edge between two records. verb must be one of: ${CLOSED_VERBS}. Server checks IN/OUT types. Never invent verbs.`,
  parameters: Schema.Struct({
    from: Schema.String.annotate({ description: "Source record id." }),
    verb: Schema.Literals(EDGE_VERBS).annotate({
      description: `Closed verb. One of: ${CLOSED_VERBS}.`,
    }),
    to: Schema.String.annotate({ description: "Target record id." }),
    meta: Schema.optional(MemoryJsonObject),
  }),
  success: Schema.Union([MemoryLinkOk, MemoryErrorResult]),
  failure: McpCapabilityUnavailableError,
  dependencies,
})
  .annotate(Tool.Title, "Link memory records")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const MemoryStatusTool = Tool.make("memory_status", {
  description:
    "Change a card's status along the legal graph. Pass confirm=true only when activating a constraint or preference. Superseding requires a successor id.",
  parameters: Schema.Struct({
    id: Schema.String.annotate({ description: "Record id." }),
    status: Schema.String.annotate({ description: "Target status." }),
    successor: Schema.optional(
      Schema.String.annotate({ description: "Required when moving to superseded." }),
    ),
    reason: Schema.optional(Schema.String),
    confirm: Schema.optional(
      Schema.Boolean.annotate({
        description: "Required to activate a constraint or preference. Never set automatically.",
      }),
    ),
  }),
  success: MemoryCardOrError,
  failure: McpCapabilityUnavailableError,
  dependencies,
})
  .annotate(Tool.Title, "Change memory status")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

const MemoryReclassifyTool = Tool.make("memory_reclassify", {
  description: `Promote a thought onto an existing closed type. Do not invent to_type; stack similar thoughts via schema_proposal. Closed types: ${CLOSED_TYPES}.`,
  parameters: Schema.Struct({
    from: Schema.String.annotate({ description: "Thought id to promote." }),
    to_type: RememberTypeSchema.annotate({
      description: `Existing closed type. One of: ${CLOSED_TYPES}.`,
    }),
    to_slug: Schema.String.annotate({ description: "Slug for the new record." }),
    title: Schema.optional(Schema.String),
    body: Schema.optional(Schema.String.annotate({ description: "Defaults to the thought body." })),
    extra: Schema.optional(MemoryJsonObject),
    links: Schema.optional(Schema.Array(MemoryLink)),
    confirm: Schema.optional(
      Schema.Boolean.annotate({
        description: "Required when the target is a constraint or preference being activated.",
      }),
    ),
  }),
  success: MemoryCardOrError,
  failure: McpCapabilityUnavailableError,
  dependencies,
})
  .annotate(Tool.Title, "Reclassify a thought")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const MemoryToolkit = Toolkit.make(
  MemoryBootstrapTool,
  MemoryRecallTool,
  MemoryGetTool,
  MemoryRememberTool,
  MemoryLinkTool,
  MemoryStatusTool,
  MemoryReclassifyTool,
);
