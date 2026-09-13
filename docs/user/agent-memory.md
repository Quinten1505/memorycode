# Agent memory

T3 Code can keep a shared semantic memory graph across providers and threads.
Agents use it to recall decisions, constraints, lessons, and other project
knowledge without re-deriving it each turn.

## Set it up

Starting T3 Code also starts a local [SurrealDB](https://surrealdb.com/) if one
is not already listening on loopback. Data lives under `~/.t3/memory/db` (not
the T3 SQLite userdata). Install the `surreal` CLI so the server can spawn it.

Defaults when you set nothing:

- URL `ws://127.0.0.1:8000`
- User / password `root` / `root`
- Namespace `harness`, database `memory`

Override with environment variables on the T3 server process:

- `SURREAL_URL` — remote or custom endpoint. Loopback URLs still autostart; a
  remote URL does not.
- `SURREAL_USER` / `SURREAL_PASS`
- `SURREAL_NS` / `SURREAL_DB`
- `SURREAL_DATA_DIR` — file store path for the autostarted process
- `SURREAL_AUTOSTART=0` — do not spawn Surreal. Combined with no `SURREAL_URL`,
  memory tools stay registered but report the backend unavailable.

Every chat already receives the `t3-code` memory tools. There is nothing to
enable per thread or per provider. If Surreal cannot start or connect, chats
still start normally; memory tool calls report that the backend is unavailable
instead of blocking the session.

After each completed turn, T3 also runs a background extractor. It stores
short observations from the turn and promotes only lines the assistant (or
user) labeled as `Decision:`, `Constraint:`, `Lesson:`, and similar closed
types. Those promotions stay `proposed` until you confirm them. A failed
extractor does not stall the chat.
