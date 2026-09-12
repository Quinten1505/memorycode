import * as Effect from "effect/Effect";

import {
  DEFAULT_BOOTSTRAP_TOKEN_CAP,
  DEFAULT_RECALL_TOKEN_CAP,
  estimateCardsTokens,
  ftsHitCount,
  sensitivityPasses,
  takeUntilTokenCap,
  toMemoryCard,
  type StoredMemoryEdge,
  type StoredMemoryRecord,
} from "./cards.ts";
import { MemoryToolError } from "./errors.ts";
import { composeRecordId, parseRecordId } from "./ids.ts";
import type {
  BootstrapInput,
  BootstrapResult,
  MemoryCard,
  RecallInput,
  RememberInput,
} from "./MemoryStore.ts";
import { scopeMatches } from "./scope.ts";
import { transitionFailure } from "./transitions.ts";
import {
  DEFAULT_STATUS,
  EDGE_ENDS,
  EDGE_VERB_SET,
  EXTRA_FIELDS,
  KNOWLEDGE_TYPES,
  LIVE_STATUSES,
  REMEMBER_TYPE_SET,
  type EdgeVerb,
  type ExtraFieldSpec,
  type RememberType,
} from "./vocabulary.ts";

export const DEFAULT_CONFIDENCE = 0.6;
export const DEFAULT_AUTHOR = "agent:harness";
export const IMMUTABLE_STATUSES = new Set(["accepted", "active", "asserted"]);
export const MULTI_EDGES = new Set(["mentions", "evidenced_by"]);
export const RECLASSIFY_FROM = new Set(["inbox", "clustered"]);
export const DEFAULT_RECALL_TYPES = new Set<string>([...KNOWLEDGE_TYPES, "thought"]);
export const DEFAULT_RECALL_K = 8;
export const MAX_RECALL_K = 20;
const MAX_BOOTSTRAP_LESSONS = 5;
const MAX_BOOTSTRAP_INBOX = 5;
const LESSON_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
const SEVERITY_RANK: Readonly<Record<string, number>> = {
  blocker: 0,
  high: 1,
  medium: 2,
};
const EXPAND_OUTGOING = new Set([
  "affects",
  "constrains",
  "in_project",
  "tagged",
  "about",
  "promoted_to",
]);

export const fail = (error: MemoryToolError["error"], hint?: string) =>
  Effect.fail(new MemoryToolError(hint === undefined ? { error } : { error, hint }));

export const isMemoryToolError = (cause: unknown): cause is MemoryToolError =>
  cause instanceof MemoryToolError;

export const parseId = (id: string) =>
  Effect.try({
    try: () => parseRecordId(id),
    catch: (cause) =>
      isMemoryToolError(cause) ? cause : new MemoryToolError({ error: "invalid_slug" }),
  });

export const composeId = (type: string, slug: string) =>
  Effect.try({
    try: () => composeRecordId(type, slug),
    catch: (cause) =>
      isMemoryToolError(cause) ? cause : new MemoryToolError({ error: "invalid_slug" }),
  });

const liveStatuses = (type: string): ReadonlySet<string> => {
  if (Object.hasOwn(LIVE_STATUSES, type)) {
    return new Set(LIVE_STATUSES[type as keyof typeof LIVE_STATUSES]);
  }
  return new Set();
};

export const isLiveRecord = (record: StoredMemoryRecord, includeProposed: boolean): boolean => {
  if (!liveStatuses(record.type).has(record.status)) {
    return false;
  }
  return includeProposed || record.status !== "proposed";
};

const byConfidenceDesc = (left: StoredMemoryRecord, right: StoredMemoryRecord) =>
  right.confidence - left.confidence;

const constraintRank = (record: StoredMemoryRecord): number => {
  const severity = record.extra.severity;
  if (typeof severity === "string" && Object.hasOwn(SEVERITY_RANK, severity)) {
    return SEVERITY_RANK[severity] ?? 3;
  }
  return 3;
};

const isRecentLesson = (record: StoredMemoryRecord, now: number): boolean => {
  const raw = record.extra.valid_from;
  if (typeof raw === "number") {
    return now - raw <= LESSON_WINDOW_MS;
  }
  if (typeof raw !== "string" || raw.length === 0) {
    return true;
  }
  const from = Date.parse(raw);
  if (Number.isNaN(from)) {
    return true;
  }
  return now - from <= LESSON_WINDOW_MS;
};

const extraSpec = (type: string): ExtraFieldSpec | undefined => {
  if (Object.hasOwn(EXTRA_FIELDS, type)) {
    return EXTRA_FIELDS[type as keyof typeof EXTRA_FIELDS];
  }
  return undefined;
};

const sameStrings = (left: ReadonlyArray<string>, right: ReadonlyArray<string>) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

export const validateExtra = (
  type: string,
  extra: Readonly<Record<string, unknown>> | undefined,
): Effect.Effect<void, MemoryToolError> => {
  const spec = extraSpec(type);
  const provided = extra ?? {};
  const keys = Object.keys(provided);
  if (spec === undefined) {
    if (keys.length > 0) {
      return fail("type_mismatch", `${type} does not accept extra fields`);
    }
    return Effect.void;
  }
  const allowed = new Set<string>(spec.keys);
  const unknown = keys.filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    return fail("type_mismatch", `allowed extra keys: ${spec.keys.join(", ")}`);
  }
  if (spec.required !== undefined) {
    const missing = spec.required.filter((key) => provided[key] === undefined);
    if (missing.length > 0) {
      return fail("type_mismatch", `missing extra: ${missing.join(", ")}`);
    }
  }
  if (spec.enums !== undefined) {
    for (const [key, values] of Object.entries(spec.enums)) {
      const value = provided[key];
      if (value !== undefined && !values.includes(value as (typeof values)[number])) {
        return fail("type_mismatch", `${key} must be one of ${values.join(", ")}`);
      }
    }
  }
  return Effect.void;
};

export const checkLinkTypes = Effect.fn("memory.checkLinkTypes")(function* (input: {
  from: string;
  verb: string;
  to: string;
}) {
  if (!EDGE_VERB_SET.has(input.verb)) {
    return yield* fail("unknown_verb");
  }
  const from = yield* parseId(input.from);
  const to = yield* parseId(input.to);
  const ends = EDGE_ENDS[input.verb as EdgeVerb];
  if (!(ends.in as readonly string[]).includes(from.type)) {
    return yield* fail("type_mismatch", `${input.verb} does not accept in type ${from.type}`);
  }
  if (!(ends.out as readonly string[]).includes(to.type)) {
    return yield* fail("type_mismatch", `${input.verb} does not accept out type ${to.type}`);
  }
  if (input.verb === "supersedes" && from.type !== to.type) {
    return yield* fail("type_mismatch", "supersedes requires the same knowledge type");
  }
});

export const validateRememberInput = Effect.fn("memory.validateRememberInput")(function* (
  input: RememberInput,
) {
  if (!REMEMBER_TYPE_SET.has(input.type)) {
    return yield* fail("unknown_type");
  }
  const id = yield* composeId(input.type, input.slug);
  if (input.scope.length === 0) {
    return yield* fail("scope_required");
  }
  yield* validateExtra(input.type, input.extra);
  return id;
});

export const buildRemember = Effect.fn("memory.buildRemember")(function* (
  input: RememberInput,
  id: string,
  existing: StoredMemoryRecord | undefined,
) {
  const body = input.body ?? existing?.body ?? "";
  const tags = input.tags === undefined ? (existing?.tags ?? []) : [...input.tags];
  const scope = [...input.scope];
  const extra = input.extra === undefined ? (existing?.extra ?? {}) : { ...input.extra };

  if (existing !== undefined && IMMUTABLE_STATUSES.has(existing.status)) {
    const bodyChanged = input.body !== undefined && input.body !== existing.body;
    const tagsChanged = input.tags !== undefined && !sameStrings(input.tags, existing.tags);
    const extraChanged =
      input.extra !== undefined && JSON.stringify(input.extra) !== JSON.stringify(existing.extra);
    if (
      input.title !== existing.title ||
      bodyChanged ||
      tagsChanged ||
      !sameStrings(scope, existing.scope) ||
      extraChanged
    ) {
      return yield* fail("immutable_live_body");
    }
  }

  const links: StoredMemoryEdge[] = [];
  for (const link of input.links ?? []) {
    yield* checkLinkTypes({ from: id, verb: link.verb, to: link.to });
    links.push({
      from: id,
      verb: link.verb,
      to: link.to,
      ...(link.meta === undefined ? {} : { meta: link.meta }),
    });
  }

  const record: StoredMemoryRecord =
    existing === undefined
      ? {
          id,
          type: input.type,
          title: input.title,
          body,
          status: DEFAULT_STATUS[input.type as RememberType],
          confidence: DEFAULT_CONFIDENCE,
          scope,
          tags,
          extra,
          authoredBy: input.authoredBy ?? DEFAULT_AUTHOR,
        }
      : {
          ...existing,
          title: IMMUTABLE_STATUSES.has(existing.status) ? existing.title : input.title,
          body: IMMUTABLE_STATUSES.has(existing.status) ? existing.body : body,
          scope: IMMUTABLE_STATUSES.has(existing.status) ? existing.scope : scope,
          tags: IMMUTABLE_STATUSES.has(existing.status) ? existing.tags : tags,
          extra: IMMUTABLE_STATUSES.has(existing.status) ? existing.extra : extra,
        };

  return { record, links };
});

export const shouldAddEdge = (
  existing: ReadonlyArray<StoredMemoryEdge>,
  edge: StoredMemoryEdge,
): boolean => {
  if (MULTI_EDGES.has(edge.verb)) {
    return true;
  }
  return !existing.some(
    (candidate) =>
      candidate.from === edge.from && candidate.verb === edge.verb && candidate.to === edge.to,
  );
};

export const applyStatus = Effect.fn("memory.applyStatus")(function* (
  input: {
    id: string;
    status: string;
    successor?: string;
    confirm?: boolean;
  },
  record: StoredMemoryRecord | undefined,
  successorExists: boolean,
) {
  const parsed = yield* parseId(input.id);
  if (record === undefined) {
    return yield* fail("not_found");
  }
  const failure = transitionFailure(parsed.type, record.status, input.status, {
    confirm: input.confirm === true,
    successor: input.successor,
  });
  if (failure !== "ok") {
    return yield* fail(failure);
  }
  if (input.status === "superseded") {
    const successorId = input.successor;
    if (successorId === undefined || successorId === "") {
      return yield* fail("successor_required");
    }
    if (!successorExists) {
      return yield* fail("not_found", "successor does not exist");
    }
    yield* checkLinkTypes({ from: successorId, verb: "supersedes", to: input.id });
    const successorEdge: StoredMemoryEdge = {
      from: successorId,
      verb: "supersedes",
      to: input.id,
    };
    return { record: { ...record, status: input.status }, successorEdge };
  }
  return { record: { ...record, status: input.status } };
});

export const planReclassifySource = Effect.fn("memory.planReclassifySource")(function* (
  from: string,
  thought: StoredMemoryRecord | undefined,
) {
  const parsed = yield* parseId(from);
  if (parsed.type !== "thought") {
    return yield* fail("not_a_thought");
  }
  if (thought === undefined) {
    return yield* fail("not_found");
  }
  if (!RECLASSIFY_FROM.has(thought.status)) {
    return yield* fail("already_promoted");
  }
  return thought;
});

export const cardOf = (
  record: StoredMemoryRecord,
  edges: ReadonlyArray<StoredMemoryEdge>,
): MemoryCard => toMemoryCard(record, edges);

const expandOneHop = (
  records: ReadonlyMap<string, StoredMemoryRecord>,
  edges: ReadonlyArray<StoredMemoryEdge>,
  hitIds: ReadonlyArray<string>,
  allowPrivate: boolean,
): MemoryCard[] => {
  const seen = new Set(hitIds);
  const neighbors: MemoryCard[] = [];
  for (const hitId of hitIds) {
    for (const edge of edges) {
      const neighborId =
        edge.from === hitId && EXPAND_OUTGOING.has(edge.verb)
          ? edge.to
          : edge.to === hitId && edge.verb === "supersedes"
            ? edge.from
            : undefined;
      if (neighborId === undefined || seen.has(neighborId)) {
        continue;
      }
      const record = records.get(neighborId);
      if (record === undefined || !sensitivityPasses(record.scope, { allowPrivate })) {
        continue;
      }
      seen.add(neighborId);
      neighbors.push(cardOf(record, edges));
    }
  }
  return neighbors;
};

const recordMap = (records: Iterable<StoredMemoryRecord>): Map<string, StoredMemoryRecord> => {
  const map = new Map<string, StoredMemoryRecord>();
  for (const record of records) {
    map.set(record.id, record);
  }
  return map;
};

export const recallFromStore = (
  records: Iterable<StoredMemoryRecord>,
  edges: ReadonlyArray<StoredMemoryEdge>,
  input: RecallInput,
): { cards: MemoryCard[]; tokens_est: number } => {
  const map = recordMap(records);
  const types = input.types === undefined ? DEFAULT_RECALL_TYPES : new Set(input.types);
  const k = Math.min(Math.max(input.k ?? DEFAULT_RECALL_K, 0), MAX_RECALL_K);
  const includeProposed = input.include_proposed === true;
  const project = input.project;
  const projectRecord = project === undefined ? undefined : map.get(`project:${project}`);
  const allowPrivate =
    projectRecord !== undefined && projectRecord.scope.includes("sensitivity:private");
  const ranked = [...map.values()]
    .filter((record) => types.has(record.type))
    .filter((record) => isLiveRecord(record, includeProposed))
    .filter((record) => project === undefined || scopeMatches(record.scope, { project }))
    .filter((record) => sensitivityPasses(record.scope, { allowPrivate }))
    .map((record) => ({
      record,
      hits: ftsHitCount(input.query, record.title, record.body),
    }))
    .filter((entry) => entry.hits > 0)
    .sort((left, right) => {
      if (right.hits !== left.hits) {
        return right.hits - left.hits;
      }
      return right.record.confidence - left.record.confidence;
    })
    .slice(0, k)
    .map((entry) => cardOf(entry.record, edges));
  const expanded = [
    ...ranked,
    ...expandOneHop(
      map,
      edges,
      ranked.map((card) => card.id),
      allowPrivate,
    ),
  ];
  const cards = takeUntilTokenCap(expanded, DEFAULT_RECALL_TOKEN_CAP);
  return { cards, tokens_est: estimateCardsTokens(cards) };
};

export const bootstrapFromStore = (
  records: Iterable<StoredMemoryRecord>,
  input: BootstrapInput,
): BootstrapResult => {
  const map = recordMap(records);
  const cap = input.max_tokens ?? DEFAULT_BOOTSTRAP_TOKEN_CAP;
  const projectRecord = map.get(`project:${input.project}`);
  const allowPrivate =
    projectRecord !== undefined && projectRecord.scope.includes("sensitivity:private");
  const scoped = [...map.values()].filter(
    (record) =>
      isLiveRecord(record, true) &&
      scopeMatches(record.scope, { project: input.project }) &&
      sensitivityPasses(record.scope, { allowPrivate }),
  );
  const now = Date.now();
  const emptyEdges: StoredMemoryEdge[] = [];
  const projectCards =
    projectRecord !== undefined &&
    isLiveRecord(projectRecord, true) &&
    sensitivityPasses(projectRecord.scope, { allowPrivate })
      ? [cardOf(projectRecord, emptyEdges)]
      : [];
  const constraints = scoped
    .filter((record) => record.type === "constraint")
    .sort((left, right) => {
      const severity = constraintRank(left) - constraintRank(right);
      return severity !== 0 ? severity : byConfidenceDesc(left, right);
    })
    .map((record) => cardOf(record, emptyEdges));
  const conventions = scoped
    .filter((record) => record.type === "convention")
    .sort(byConfidenceDesc)
    .map((record) => cardOf(record, emptyEdges));
  const preferences = scoped
    .filter((record) => record.type === "preference")
    .sort(byConfidenceDesc)
    .map((record) => cardOf(record, emptyEdges));
  const openIncidents = scoped
    .filter((record) => record.type === "incident")
    .sort(byConfidenceDesc)
    .map((record) => cardOf(record, emptyEdges));
  const recentLessons = scoped
    .filter((record) => record.type === "lesson" && isRecentLesson(record, now))
    .sort(byConfidenceDesc)
    .slice(0, MAX_BOOTSTRAP_LESSONS)
    .map((record) => cardOf(record, emptyEdges));
  const inbox =
    input.include_inbox === true
      ? scoped
          .filter((record) => record.type === "thought")
          .sort(byConfidenceDesc)
          .slice(0, MAX_BOOTSTRAP_INBOX)
          .map((record) => cardOf(record, emptyEdges))
      : undefined;

  const buckets: Array<{ cards: MemoryCard[] }> = [
    { cards: recentLessons },
    ...(inbox === undefined ? [] : [{ cards: inbox }]),
    { cards: conventions },
    { cards: preferences },
    { cards: openIncidents },
    { cards: constraints },
    { cards: projectCards },
  ];
  const allCards = () => buckets.flatMap((bucket) => bucket.cards);
  while (estimateCardsTokens(allCards()) > cap) {
    const bucket = buckets.find((candidate) => candidate.cards.length > 0);
    if (bucket === undefined) {
      break;
    }
    bucket.cards.pop();
  }

  const result: BootstrapResult = {
    constraints,
    conventions,
    preferences,
    open_incidents: openIncidents,
    recent_lessons: recentLessons,
    tokens_est: estimateCardsTokens(allCards()),
  };
  const projectCard = projectCards[0];
  if (projectCard !== undefined) {
    return inbox === undefined
      ? { ...result, project: projectCard }
      : { ...result, project: projectCard, inbox };
  }
  return inbox === undefined ? result : { ...result, inbox };
};
