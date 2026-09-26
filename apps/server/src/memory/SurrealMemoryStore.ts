import * as Effect from "effect/Effect";
import { RecordId } from "surrealdb";

import type { StoredMemoryEdge, StoredMemoryRecord } from "./cards.ts";
import { MemoryToolError } from "./errors.ts";
import { parseRecordId } from "./ids.ts";
import type { MemoryEmbedder } from "./ollamaEmbed.ts";
import {
  findMap,
  mapStorageId,
  planMapApply,
  presentMap,
  receiptIdFor,
  workspaceProjectId,
  type MapCommit,
  type MapReceipt,
} from "./mapApply.ts";
import type {
  BootstrapInput,
  IngestTurnInput,
  MapApplyInput,
  MapReadInput,
  MemoryStore,
  RecallInput,
  RememberInput,
} from "./MemoryStore.ts";
import { kebabSlug, runIngestTurn, runSlugForTurn } from "./ingestTurn.ts";
import {
  applyStatus,
  assertReclassifyTarget,
  bootstrapFromStore,
  buildRemember,
  cardOf,
  checkLinkTypes,
  DEFAULT_AUTHOR,
  DEFAULT_CONFIDENCE,
  DEFAULT_RECALL_K,
  DEFAULT_RECALL_TYPES,
  MAX_RECALL_K,
  fail,
  isMemoryToolError,
  neighborIdsFromHits,
  parseId,
  planReclassifySource,
  recallFromStore,
  shouldAddEdge,
  validateRememberInput,
  withEdgeDefaults,
} from "./storeLogic.ts";
import {
  EDGE_VERBS,
  EDGE_VERB_SET,
  EXTRA_FIELDS,
  L3_TYPES,
  MAP_EXTRA_FIELDS,
  REMEMBER_TYPE_SET,
  type RememberType,
} from "./vocabulary.ts";

export type MemorySurrealClient = {
  readonly connect: (url: string, options?: object) => Promise<unknown>;
  readonly query: (sql: string, vars?: Record<string, unknown>) => unknown;
};

const FULL_SPINE = new Set<string>([...L3_TYPES, "episode", "work_map", "question"]);
const HAS_BODY = new Set<string>([...FULL_SPINE, "component", "interface", "observation"]);
const EDGE_TABLE_SQL = EDGE_VERBS.join(", ");
const BOOTSTRAP_TABLE_SQL =
  "project, constraint, convention, preference, incident, lesson, thought";

const isCollectable = (value: unknown): value is { collect: () => Promise<unknown> } =>
  value !== null &&
  typeof value === "object" &&
  "collect" in value &&
  typeof (value as { collect?: unknown }).collect === "function";

const tableName = (table: unknown): string | undefined => {
  if (typeof table === "string") {
    return table;
  }
  if (table !== null && typeof table === "object" && "name" in table) {
    const name = (table as { name: unknown }).name;
    return typeof name === "string" ? name : undefined;
  }
  return undefined;
};

const stringifyId = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof RecordId) {
    const table = tableName(value.table) ?? String(value.table);
    return `${table}:${String(value.id)}`;
  }
  if (value !== null && typeof value === "object") {
    const rec = value as { tb?: unknown; table?: unknown; id?: unknown };
    const table = typeof rec.tb === "string" ? rec.tb : tableName(rec.table);
    if (table !== undefined && rec.id !== undefined && rec.id !== null) {
      const inner = typeof rec.id === "object" ? stringifyId(rec.id) : String(rec.id);
      return inner === undefined ? undefined : `${table}:${inner}`;
    }
  }
  return undefined;
};

const asStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  if (value instanceof Set) {
    return [...value].filter((entry): entry is string => typeof entry === "string");
  }
  return [];
};

const extraKeys = (type: string): readonly string[] => {
  if (Object.hasOwn(EXTRA_FIELDS, type)) {
    return EXTRA_FIELDS[type as keyof typeof EXTRA_FIELDS].keys;
  }
  if (Object.hasOwn(MAP_EXTRA_FIELDS, type)) {
    return MAP_EXTRA_FIELDS[type as keyof typeof MAP_EXTRA_FIELDS].keys;
  }
  return [];
};

const datetimeString = (value: unknown): string | undefined => {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  return undefined;
};

const fromRow = (row: unknown): StoredMemoryRecord | undefined => {
  if (row === null || typeof row !== "object" || Array.isArray(row)) {
    return undefined;
  }
  const obj = row as Record<string, unknown>;
  const id = stringifyId(obj.id);
  if (id === undefined) {
    return undefined;
  }
  let parsed: { type: string; slug: string };
  try {
    parsed = parseRecordId(id);
  } catch {
    return undefined;
  }
  const extra: Record<string, unknown> = {};
  for (const key of extraKeys(parsed.type)) {
    if (obj[key] !== undefined) {
      extra[key] = obj[key];
    }
  }
  const validFrom = datetimeString(obj.valid_from);
  return {
    id,
    type: parsed.type,
    title: typeof obj.title === "string" ? obj.title : "",
    body: typeof obj.body === "string" ? obj.body : "",
    status: typeof obj.status === "string" ? obj.status : "",
    confidence: typeof obj.confidence === "number" ? obj.confidence : DEFAULT_CONFIDENCE,
    scope: asStringArray(obj.scope),
    tags: asStringArray(obj.tags),
    extra,
    authoredBy: stringifyId(obj.authored_by) ?? DEFAULT_AUTHOR,
    ...(validFrom === undefined ? {} : { validFrom }),
  };
};

const flattenRows = (result: unknown): unknown[] => {
  if (result === null || result === undefined) {
    return [];
  }
  if (!Array.isArray(result)) {
    return [result];
  }
  const rows: unknown[] = [];
  for (const item of result) {
    if (Array.isArray(item)) {
      for (const inner of item) {
        if (inner !== null && inner !== undefined) {
          rows.push(inner);
        }
      }
    } else if (item !== null && item !== undefined) {
      rows.push(item);
    }
  }
  return rows;
};

const fromEdgeRow = (row: unknown): StoredMemoryEdge | undefined => {
  if (row === null || typeof row !== "object" || Array.isArray(row)) {
    return undefined;
  }
  const obj = row as Record<string, unknown>;
  const from = stringifyId(obj.in);
  const to = stringifyId(obj.out);
  const idTable =
    obj.id instanceof RecordId
      ? tableName(obj.id.table)
      : tableName((obj.id as { table?: unknown } | undefined)?.table);
  const verb = idTable ?? stringifyId(obj.id)?.split(":")[0];
  if (from === undefined || to === undefined || verb === undefined) {
    return undefined;
  }
  const meta: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (
      key === "id" ||
      key === "in" ||
      key === "out" ||
      key === "created_at" ||
      key === "source_run"
    ) {
      continue;
    }
    if (value !== undefined) {
      meta[key] = value;
    }
  }
  return Object.keys(meta).length === 0 ? { from, verb, to } : { from, verb, to, meta };
};

const toRecordId = (id: string): RecordId => {
  const parsed = parseRecordId(id);
  return new RecordId(parsed.type, parsed.slug);
};

const toContent = (
  record: StoredMemoryRecord,
  embedding?: ReadonlyArray<number>,
): Record<string, unknown> => {
  const content: Record<string, unknown> = {
    title: record.title,
    status: record.status,
    scope: new Set(record.scope),
    tags: new Set(record.tags),
  };
  if (HAS_BODY.has(record.type)) {
    content.body = record.body;
  }
  if (embedding !== undefined && embedding.length > 0) {
    content.embedding = [...embedding];
  }
  if (FULL_SPINE.has(record.type)) {
    content.confidence = record.confidence;
    try {
      const author = parseRecordId(record.authoredBy);
      content.authored_by = new RecordId(author.type, author.slug);
    } catch {
      content.authored_by = new RecordId("agent", "harness");
    }
    if (record.validFrom !== undefined) {
      const parsed = Date.parse(record.validFrom);
      content.valid_from = Number.isNaN(parsed) ? record.validFrom : new Date(parsed);
    }
  }
  Object.assign(content, record.extra);
  return content;
};

const backendUnavailable = (cause: unknown): MemoryToolError =>
  isMemoryToolError(cause) ? cause : new MemoryToolError({ error: "backend_unavailable" });

const embedText = (title: string, body: string): string => `${title}\n${body}`.trim();

export const makeSurrealMemoryStore = (
  client: MemorySurrealClient,
  embedder?: MemoryEmbedder,
): MemoryStore => {
  const run = Effect.fn("SurrealMemoryStore.query")(function* (
    sql: string,
    vars?: Record<string, unknown>,
  ) {
    return yield* Effect.tryPromise({
      try: async () => {
        const raw = client.query(sql, vars);
        if (isCollectable(raw)) {
          return flattenRows(await raw.collect());
        }
        return flattenRows(await raw);
      },
      catch: backendUnavailable,
    });
  });

  const loadRecord = Effect.fn("SurrealMemoryStore.loadRecord")(function* (id: string) {
    yield* parseId(id);
    const rows = yield* run("SELECT * FROM ONLY $id", { id: toRecordId(id) });
    for (const row of rows) {
      const record = fromRow(row);
      if (record !== undefined) {
        return record;
      }
    }
    return undefined;
  });

  const loadEdgesFor = Effect.fn("SurrealMemoryStore.loadEdgesFor")(function* (id: string) {
    const rows = yield* run(`SELECT * FROM ${EDGE_TABLE_SQL} WHERE in = $id OR out = $id`, {
      id: toRecordId(id),
    });
    return rows.flatMap((row) => {
      const edge = fromEdgeRow(row);
      return edge === undefined ? [] : [edge];
    });
  });

  const loadAllEdges = Effect.fn("SurrealMemoryStore.loadAllEdges")(function* () {
    const rows = yield* run(`SELECT * FROM ${EDGE_TABLE_SQL}`);
    return rows.flatMap((row) => {
      const edge = fromEdgeRow(row);
      return edge === undefined ? [] : [edge];
    });
  });

  const persistEdge = Effect.fn("SurrealMemoryStore.persistEdge")(function* (
    edge: StoredMemoryEdge,
  ) {
    const next = withEdgeDefaults(edge);
    if (!EDGE_VERB_SET.has(next.verb)) {
      return yield* fail("unknown_verb");
    }
    const existing = yield* run(`SELECT * FROM ${next.verb} WHERE in = $from AND out = $to`, {
      from: toRecordId(next.from),
      to: toRecordId(next.to),
    });
    const already = existing.flatMap((row) => {
      const parsed = fromEdgeRow(row);
      return parsed === undefined ? [] : [parsed];
    });
    if (!shouldAddEdge(already, next)) {
      return;
    }
    yield* run(`RELATE $from->${next.verb}->$to CONTENT $meta`, {
      from: toRecordId(next.from),
      to: toRecordId(next.to),
      meta: next.meta ?? {},
    });
  });

  const cardFor = Effect.fn("SurrealMemoryStore.cardFor")(function* (record: StoredMemoryRecord) {
    const edges = yield* loadEdgesFor(record.id);
    return cardOf(record, edges);
  });

  const tryEmbed = (text: string) =>
    Effect.tryPromise({
      try: () => (embedder === undefined ? Promise.resolve(undefined) : embedder.embed(text)),
      catch: () => undefined,
    }).pipe(Effect.orElseSucceed(() => undefined));

  const remember = Effect.fn("SurrealMemoryStore.remember")(function* (input: RememberInput) {
    const id = yield* validateRememberInput(input);
    const existing = yield* loadRecord(id);
    const { record, links } = yield* buildRemember(input, id, existing);
    const embedding = HAS_BODY.has(record.type)
      ? yield* tryEmbed(embedText(record.title, record.body))
      : undefined;
    const writeSql = "UPSERT $id MERGE $content RETURN AFTER";
    const rows = yield* run(writeSql, {
      id: toRecordId(id),
      content: toContent(record, embedding),
    });
    for (const link of links) {
      yield* persistEdge(link);
    }
    const stored = rows.flatMap((row) => {
      const parsed = fromRow(row);
      return parsed === undefined ? [] : [parsed];
    })[0];
    return { card: yield* cardFor(stored ?? record) };
  });

  const get = Effect.fn("SurrealMemoryStore.get")(function* (input: { id: string }) {
    yield* parseId(input.id);
    const record = yield* loadRecord(input.id);
    if (record === undefined) {
      return yield* fail("not_found");
    }
    return { card: yield* cardFor(record) };
  });

  const link = Effect.fn("SurrealMemoryStore.link")(function* (input: {
    from: string;
    verb: string;
    to: string;
    meta?: Readonly<Record<string, unknown>>;
  }) {
    yield* checkLinkTypes(input);
    const fromRecord = yield* loadRecord(input.from);
    const toRecord = yield* loadRecord(input.to);
    if (fromRecord === undefined || toRecord === undefined) {
      return yield* fail("not_found");
    }
    yield* persistEdge({
      from: input.from,
      verb: input.verb,
      to: input.to,
      ...(input.meta === undefined ? {} : { meta: input.meta }),
    });
    return { ok: true } as const;
  });

  const status = Effect.fn("SurrealMemoryStore.status")(function* (input: {
    id: string;
    status: string;
    successor?: string;
    reason?: string;
    confirm?: boolean;
  }) {
    const record = yield* loadRecord(input.id);
    const successorExists =
      input.successor !== undefined && (yield* loadRecord(input.successor)) !== undefined;
    const planned = yield* applyStatus(input, record, successorExists);
    yield* run("UPDATE $id SET status = $status RETURN AFTER", {
      id: toRecordId(input.id),
      status: input.status,
    });
    if (planned.successorEdge !== undefined) {
      yield* persistEdge(planned.successorEdge);
    }
    return { card: yield* cardFor(planned.record) };
  });

  const reclassify = Effect.fn("SurrealMemoryStore.reclassify")(function* (input: {
    from: string;
    to_type: string;
    to_slug: string;
    title?: string;
    body?: string;
    extra?: Readonly<Record<string, unknown>>;
    links?: RememberInput["links"];
    confirm?: boolean;
  }) {
    const thought = yield* planReclassifySource(input.from, yield* loadRecord(input.from));
    yield* assertReclassifyTarget(input.to_type);
    const created = yield* remember({
      type: input.to_type,
      slug: input.to_slug,
      title: input.title ?? thought.title,
      body: input.body ?? thought.body,
      scope: thought.scope,
      tags: thought.tags,
      extra: input.extra,
      links: input.links,
      confirm: input.confirm,
    });
    yield* link({ from: input.from, verb: "promoted_to", to: created.card.id });
    yield* status({ id: input.from, status: "promoted" });
    return created;
  });

  const loadTyped = Effect.fn("SurrealMemoryStore.loadTyped")(function* (sql: string) {
    const rows = yield* run(sql);
    return rows.flatMap((row) => {
      const record = fromRow(row);
      return record === undefined ? [] : [record];
    });
  });

  const pushRows = (records: StoredMemoryRecord[], rows: unknown[]) => {
    for (const row of rows) {
      const parsed = fromRow(row);
      if (parsed !== undefined) {
        records.push(parsed);
      }
    }
  };

  const recall = Effect.fn("SurrealMemoryStore.recall")(function* (input: RecallInput) {
    const types =
      input.types === undefined
        ? [...DEFAULT_RECALL_TYPES]
        : [...new Set(input.types.filter((type) => REMEMBER_TYPE_SET.has(type as RememberType)))];
    if (types.length === 0) {
      return { cards: [], tokens_est: 0 };
    }
    const withBody = types.filter((type) => HAS_BODY.has(type));
    const titleOnly = types.filter((type) => !HAS_BODY.has(type));
    const records: StoredMemoryRecord[] = [];
    if (withBody.length > 0) {
      const rows = yield* run(
        `SELECT * FROM ${withBody.join(", ")} WHERE title ~ $q OR body ~ $q`,
        { q: input.query },
      );
      pushRows(records, rows);
    }
    if (titleOnly.length > 0) {
      const rows = yield* run(`SELECT * FROM ${titleOnly.join(", ")} WHERE title ~ $q`, {
        q: input.query,
      });
      pushRows(records, rows);
    }
    const k = Math.min(Math.max(input.k ?? DEFAULT_RECALL_K, 1), MAX_RECALL_K);
    const queryVector = yield* tryEmbed(input.query);
    const vectorScores = new Map<string, number>();
    if (queryVector !== undefined && withBody.length > 0) {
      const knnRows = yield* run(
        `SELECT *, vector::similarity::cosine(embedding, $vec) AS vector_score FROM ${withBody.join(", ")} WHERE embedding <|${k},40|> $vec`,
        { vec: [...queryVector] },
      ).pipe(Effect.orElseSucceed(() => [] as unknown[]));
      let rank = knnRows.length;
      for (const row of knnRows) {
        const parsed = fromRow(row);
        if (parsed === undefined) {
          continue;
        }
        const score =
          row !== null && typeof row === "object" && !Array.isArray(row)
            ? (row as { vector_score?: unknown }).vector_score
            : undefined;
        vectorScores.set(
          parsed.id,
          typeof score === "number" ? score : rank / Math.max(knnRows.length, 1),
        );
        rank -= 1;
        if (!records.some((record) => record.id === parsed.id)) {
          records.push(parsed);
        }
      }
    }
    const edges = yield* loadAllEdges();
    const loadedIds = new Set(records.map((record) => record.id));
    const neighborIds = neighborIdsFromHits(
      edges,
      records.map((record) => record.id),
    ).filter((id) => !loadedIds.has(id));
    const neighborRecordIds: RecordId[] = [];
    for (const id of neighborIds) {
      try {
        neighborRecordIds.push(toRecordId(id));
      } catch {
        continue;
      }
    }
    if (neighborRecordIds.length > 0) {
      const rows = yield* run("SELECT * FROM $ids", { ids: neighborRecordIds });
      pushRows(records, rows);
    }
    return recallFromStore(
      records,
      edges,
      input,
      vectorScores.size === 0 ? undefined : vectorScores,
    );
  });

  const bootstrap = Effect.fn("SurrealMemoryStore.bootstrap")(function* (input: BootstrapInput) {
    const records = yield* loadTyped(`SELECT * FROM ${BOOTSTRAP_TABLE_SQL}`);
    return bootstrapFromStore(records, input);
  });

  const loadContains = Effect.fn("SurrealMemoryStore.loadContains")(function* (id: string) {
    const rows = yield* run("SELECT * FROM contains WHERE in = $id", { id: toRecordId(id) });
    return rows.flatMap((row) => {
      const edge = fromEdgeRow(row);
      return edge === undefined ? [] : [edge];
    });
  });

  const loadWorktreeEdges = Effect.fn("SurrealMemoryStore.loadWorktreeEdges")(function* (
    id: string,
  ) {
    const rows = yield* run("SELECT * FROM worktree_of WHERE in = $id", { id: toRecordId(id) });
    return rows.flatMap((row) => {
      const edge = fromEdgeRow(row);
      return edge === undefined ? [] : [edge];
    });
  });

  const loadReceipt = Effect.fn("SurrealMemoryStore.loadReceipt")(function* (id: string) {
    const rows = yield* run("SELECT * FROM ONLY $id", { id: toRecordId(id) });
    for (const row of rows) {
      if (row === null || typeof row !== "object" || Array.isArray(row)) {
        continue;
      }
      const record = row as { idempotency_key?: unknown; result?: unknown };
      if (
        typeof record.idempotency_key !== "string" ||
        record.result === null ||
        typeof record.result !== "object" ||
        !("mapId" in record.result)
      ) {
        continue;
      }
      return {
        idempotencyKey: record.idempotency_key,
        result: record.result as MapReceipt["result"],
      } satisfies MapReceipt;
    }
    return undefined;
  });

  const writeCommit = Effect.fn("SurrealMemoryStore.writeCommit")(function* (commit: MapCommit) {
    const vars: Record<string, unknown> = { map_id: toRecordId(commit.mapId) };
    const lines = ["BEGIN TRANSACTION;", "DELETE contains WHERE in = $map_id;"];
    commit.upserts.forEach((record, index) => {
      vars[`id_${index}`] = toRecordId(record.id);
      vars[`content_${index}`] = toContent(record);
      lines.push(`UPSERT $id_${index} MERGE $content_${index};`);
    });
    commit.deleteIds.forEach((id, index) => {
      vars[`delete_${index}`] = toRecordId(id);
      lines.push(`DELETE $delete_${index};`);
    });
    commit.edges.forEach((edge, index) => {
      const verb = edge.verb === "worktree_of" ? "worktree_of" : "contains";
      vars[`from_${index}`] = toRecordId(edge.from);
      vars[`to_${index}`] = toRecordId(edge.to);
      vars[`meta_${index}`] = edge.meta ?? {};
      lines.push(`RELATE $from_${index}->${verb}->$to_${index} CONTENT $meta_${index};`);
    });
    vars.receipt_id = toRecordId(commit.receiptId);
    vars.receipt = {
      idempotency_key: commit.receipt.idempotencyKey,
      result: commit.receipt.result,
      map_id: commit.result.mapId,
      revision: commit.result.revision,
    };
    lines.push("UPSERT $receipt_id MERGE $receipt;");
    lines.push("COMMIT TRANSACTION;");
    yield* run(lines.join("\n"), vars);
  });

  const applyMap = Effect.fn("SurrealMemoryStore.applyMap")(function* (input: MapApplyInput) {
    const records = new Map<string, StoredMemoryRecord>();
    const edges: StoredMemoryEdge[] = [];
    const mapId = mapStorageId(input.identity, input.slug);
    if (mapId !== undefined) {
      const map = yield* loadRecord(mapId);
      if (map !== undefined) {
        records.set(map.id, map);
        const memberEdges = yield* loadContains(mapId);
        edges.push(...memberEdges);
        for (const edge of memberEdges) {
          const member = yield* loadRecord(edge.to);
          if (member !== undefined) {
            records.set(member.id, member);
          }
        }
      }
    }
    for (const projectId of [
      workspaceProjectId(input.identity.workspaceKey),
      workspaceProjectId(input.identity.primaryWorkspaceKey),
    ]) {
      const project = yield* loadRecord(projectId);
      if (project !== undefined) {
        records.set(project.id, project);
      }
    }
    edges.push(...(yield* loadWorktreeEdges(workspaceProjectId(input.identity.workspaceKey))));
    const receipt = yield* loadReceipt(receiptIdFor(input.idempotencyKey.trim(), input.identity));
    const plan = yield* planMapApply({ records, edges, receipt }, input);
    if (plan.kind === "replay") {
      return plan.result;
    }
    yield* writeCommit(plan.commit);
    return plan.commit.result;
  });

  const readMap = Effect.fn("SurrealMemoryStore.readMap")(function* (input: MapReadInput) {
    if (input.id === undefined && input.slug === undefined) {
      return yield* fail("scope_required", "Pass id or slug.");
    }
    const loaded: StoredMemoryRecord[] = [];
    if (input.id !== undefined) {
      const record = yield* loadRecord(input.id);
      if (record !== undefined) {
        loaded.push(record);
      }
    } else {
      const rows = yield* run(
        "SELECT * FROM work_map WHERE environment_id = $environment AND user_slug = $slug",
        { environment: input.identity.environmentId, slug: input.slug },
      );
      for (const row of rows) {
        const record = fromRow(row);
        if (record !== undefined) {
          loaded.push(record);
        }
      }
    }
    const map = findMap(loaded, input);
    if (map === undefined) {
      return yield* fail("not_found");
    }
    const memberEdges = yield* loadContains(map.id);
    const records = new Map<string, StoredMemoryRecord>([[map.id, map]]);
    for (const edge of memberEdges) {
      const member = yield* loadRecord(edge.to);
      if (member !== undefined) {
        records.set(member.id, member);
      }
    }
    return presentMap(map, records, memberEdges, input.view);
  });

  const ingestTurn = Effect.fn("SurrealMemoryStore.ingestTurn")(function* (input: IngestTurnInput) {
    const runSlug = runSlugForTurn(input.turnId);
    const providerSlug = kebabSlug(input.provider) || "other";
    yield* run("UPSERT $id MERGE $content RETURN AFTER", {
      id: toRecordId(`run:${runSlug}`),
      content: {
        provider: toRecordId(`provider:${providerSlug}`),
        agent: toRecordId("agent:extractor"),
        t3_thread_id: input.threadId,
        t3_turn_id: input.turnId,
        status: "completed",
      },
    });
    return yield* runIngestTurn(
      { remember, recall },
      (draft) =>
        run("UPSERT $id MERGE $content RETURN AFTER", {
          id: toRecordId(`observation:${draft.slug}`),
          content: {
            title: draft.title,
            body: draft.body,
            kind: draft.kind,
            status: "open",
            scope: new Set([`project:${input.projectSlug}`]),
            tags: new Set<string>(),
            source_run: toRecordId(`run:${runSlug}`),
          },
        }).pipe(Effect.map(() => `observation:${draft.slug}`)),
      input,
    );
  });

  return {
    remember,
    get,
    status,
    link,
    reclassify,
    recall,
    bootstrap,
    ingestTurn,
    applyMap,
    readMap,
  };
};
