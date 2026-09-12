# Agent memory

Harness memory tools ride on the existing `t3-code` HTTP MCP session that every
provider adapter already attaches. That keeps one capability path for local,
remote, and tunnel environments, and avoids a per-provider stdio sidecar or
workspace `.mcp.json` that would drift across adapters and connection modes.

On server boot, [MemoryService](../../apps/server/src/memory/MemoryService.ts)
starts a loopback Surreal process when `SURREAL_AUTOSTART` is on (the default)
and the target URL is localhost. It reuses an already-healthy instance and
never kills a process it did not spawn. Data is stored under `~/.t3/memory`,
not `userdata`, so worktrees share one graph. A remote `SURREAL_URL` skips
spawn. When start or connect fails, the service still registers and serves an
unavailable store so turns start and tools fail closed with
`backend_unavailable`.

Tool schemas and handlers live under
[toolkits/memory](../../apps/server/src/mcp/toolkits/memory/). The store and
schema apply path live under
[memory/](../../apps/server/src/memory/).

## Turn-end extractor (Phase C)

After `turn.completed`, [MemoryIngestReactor](../../apps/server/src/orchestration/Layers/MemoryIngestReactor.ts)
runs asynchronously (`forkParked`). Failures log and publish nothing that
blocks the T3 turn.

The job does not copy the transcript into Surreal (L0 stays in T3). It:

1. Upserts a `run` pointing at `thread_id` / `turn_id`.
2. Writes `observation` rows from user/assistant text (tail-capped).
3. Promotes only **labeled** lines (`Constraint: …`, `Decision: …`, `Lesson: …`,
   and the other closed types) via the same `remember` path agents use.
   Constraints stay `proposed`. The promoter never sets `confirm: true`.
4. Skips a promotion when recall already has a live card with the same title
   in that project.

This is heuristic, not a second LLM. Agents can still call `memory_remember`
during the turn; ingest is the backstop when they do not.
