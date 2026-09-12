---
name: harness-memory
description: Read and write the shared T3 harness memory graph. Use at the start of project work, when a decision/constraint/lesson/incident is established, or when recalling prior art across threads and providers.
---

# Harness memory

Call t3-code MCP tools. Never write SurrealQL.

1. Start of project work: `memory_bootstrap` with `project` = workspace directory basename.
2. Need prior art: `memory_recall`.
3. Established knowledge: `memory_remember` with a closed type and slug you control (`type:slug`).
4. Does not fit: `type=thought` plus `extra.facet` (kebab). Do not invent tables.
5. Promote a thought: `memory_reclassify` onto an existing type.
6. Hard rules (`constraint`, `preference`) stay `proposed` until `memory_status` with `confirm: true`.
7. Change a live body: `memory_status` superseded with a successor id, do not rewrite.

Closed types: decision, constraint, convention, lesson, incident, skill, preference, fact, concept, thought, schema_proposal, component, interface, episode, artifact, person, vendor, tool, project, repo, symbol.

Closed verbs: in_project, promoted_to, motivated, about, in_repo, implements, depends_on, affects, constrains, supersedes, contradicts, learned_in, evidenced_by, uses_tool, owned_by, tagged, mentions, occurred_in.
