# Agent memory

Harness memory tools ride on the existing `t3-code` HTTP MCP session that every
provider adapter already attaches. That keeps one capability path for local,
remote, and tunnel environments, and avoids a per-provider stdio sidecar or
workspace `.mcp.json` that would drift across adapters and connection modes.

T3 does not spawn Surreal. Operators own the database process and point the
server at it with `SURREAL_*` env vars. When the URL is missing or connect fails,
[MemoryService](../../apps/server/src/memory/MemoryService.ts) still registers
and serves an unavailable store so turns start and tools fail closed with
`backend_unavailable`.

Tool schemas and handlers live under
[toolkits/memory](../../apps/server/src/mcp/toolkits/memory/). The store and
schema apply path live under
[memory/](../../apps/server/src/memory/).
