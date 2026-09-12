# Agent memory

T3 Code can keep a shared semantic memory graph across providers and threads.
Agents use it to recall decisions, constraints, lessons, and other project
knowledge without re-deriving it each turn.

## Set it up

Memory is optional. Run [SurrealDB](https://surrealdb.com/) yourself, then set
these environment variables on the T3 server process before starting it:

- `SURREAL_URL` — Surreal endpoint (required to enable the backend)
- `SURREAL_USER` / `SURREAL_PASS` — credentials Surreal accepts
- `SURREAL_NS` — defaults to `harness` if unset
- `SURREAL_DB` — defaults to `memory` if unset

Example:

```bash
export SURREAL_URL=http://127.0.0.1:8000
export SURREAL_USER=root
export SURREAL_PASS=root
# optional:
# export SURREAL_NS=harness
# export SURREAL_DB=memory
```

Every chat already receives the `t3-code` memory tools. There is nothing to
enable per thread or per provider. If Surreal is unset or unreachable, chats
still start normally; memory tool calls report that the backend is unavailable
instead of blocking the session.
