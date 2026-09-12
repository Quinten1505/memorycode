import * as Schema from "effect/Schema";

export class MemoryToolError extends Schema.TaggedError<MemoryToolError>()("MemoryToolError", {
  error: Schema.Literals([
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
  ]),
  hint: Schema.optional(Schema.String),
}) {}
