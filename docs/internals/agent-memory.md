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
