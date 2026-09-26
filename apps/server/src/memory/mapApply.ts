import { createHash } from "node:crypto";

import * as Effect from "effect/Effect";

import type { StoredMemoryEdge, StoredMemoryRecord } from "./cards.ts";
import { MemoryToolError } from "./errors.ts";
import type { MapApplyInput, MapApplyResult, MapIdentity, MapReadResult } from "./MemoryStore.ts";
import { fail } from "./storeLogic.ts";

const SLUG = /^[a-z0-9-]{1,60}$/;
const AUTHOR = "agent:harness";

export type MapReceipt = {
  readonly idempotencyKey: string;
  readonly result: MapApplyResult;
};

export type MapSnapshot = {
  readonly records: ReadonlyMap<string, StoredMemoryRecord>;
  readonly edges: ReadonlyArray<StoredMemoryEdge>;
  readonly receipt: MapReceipt | undefined;
};

export type MapCommit = {
  readonly upserts: ReadonlyArray<StoredMemoryRecord>;
  readonly deleteIds: ReadonlyArray<string>;
  readonly mapId: string;
  readonly edges: ReadonlyArray<StoredMemoryEdge>;
  readonly receiptId: string;
  readonly receipt: MapReceipt;
  readonly result: MapApplyResult;
};

export type MapPlan =
  | { readonly kind: "replay"; readonly result: MapApplyResult }
  | { readonly kind: "commit"; readonly commit: MapCommit };

export const normalizeWorkspaceKey = (path: string): string => {
  const slashed = path.replaceAll("\\", "/").replace(/\/+$/, "");
  return slashed.length === 0 ? path : slashed;
};

export const digestKey = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

export const workspaceProjectId = (workspaceKey: string): string =>
  `project:ws-${digestKey(workspaceKey).slice(0, 20)}`;

export const receiptIdFor = (idempotencyKey: string, identity: MapIdentity): string =>
  `map_apply:${digestKey(`${identity.environmentId}\0${identity.workspaceKey}\0${idempotencyKey}`).slice(0, 32)}`;

const scopePrefix = (identity: MapIdentity): string =>
  digestKey(`${identity.environmentId}\0${identity.workspaceKey}`).slice(0, 10);

const mapRecordId = (identity: MapIdentity, slug: string): string =>
  `work_map:${scopePrefix(identity)}-${slug}`;

export const mapStorageId = (identity: MapIdentity, slug: string): string | undefined =>
  SLUG.test(slug) ? mapRecordId(identity, slug) : undefined;

const memberRecordId = (
  identity: MapIdentity,
  role: "q" | "f" | "x",
  slug: string,
  type: "question" | "thought",
): string => `${type}:${scopePrefix(identity)}-${role}-${slug}`;

const baseName = (key: string): string => {
  const parts = key.split(/[/\\]/).filter((part) => part.length > 0);
  return parts.at(-1) ?? key;
};

const checkSlug = (slug: string, label: string) => {
  if (!SLUG.test(slug)) {
    return fail("invalid_slug", `${label} must match ^[a-z0-9-]{1,60}$`);
  }
  return Effect.void;
};

const revisionOf = (record: StoredMemoryRecord | undefined): number => {
  if (record === undefined) {
    return 0;
  }
  const value = record.extra.revision;
  return typeof value === "number" && Number.isInteger(value) ? value : 0;
};

const text = (extra: Readonly<Record<string, unknown>>, key: string): string => {
  const value = extra[key];
  return typeof value === "string" ? value : "";
};

const mapScope = (identity: MapIdentity): string[] => {
  const project = identity.repositoryKey ?? identity.primaryWorkspaceKey;
  const tokens = [
    `environment:${identity.environmentId}`,
    `workspace:${identity.workspaceKey}`,
    `project:${project}`,
  ];
  if (identity.repositoryKey !== null && identity.repositoryKey.length > 0) {
    tokens.push(`repo:${identity.repositoryKey}`);
  }
  return tokens;
};

const spine = (
  id: string,
  type: string,
  title: string,
  body: string,
  status: string,
  scope: ReadonlyArray<string>,
  extra: Readonly<Record<string, unknown>>,
  prior: StoredMemoryRecord | undefined,
): StoredMemoryRecord => ({
  id,
  type,
  title,
  body,
  status,
  confidence: prior?.confidence ?? 0.6,
  scope,
  tags: prior?.tags ?? [],
  extra,
  authoredBy: prior?.authoredBy ?? AUTHOR,
  ...(prior?.validFrom !== undefined ? { validFrom: prior.validFrom } : {}),
});

const sameProject = (record: StoredMemoryRecord, identity: MapIdentity): boolean => {
  if (text(record.extra, "environment_id") !== identity.environmentId) {
    return false;
  }
  const repository = text(record.extra, "repository_key");
  if (
    identity.repositoryKey !== null &&
    identity.repositoryKey.length > 0 &&
    repository.length > 0 &&
    repository !== identity.repositoryKey
  ) {
    return false;
  }
  if (text(record.extra, "workspace_key") === identity.workspaceKey) {
    return true;
  }
  return text(record.extra, "primary_workspace_key") === identity.primaryWorkspaceKey;
};

export const findMap = (
  records: Iterable<StoredMemoryRecord>,
  input: { readonly identity: MapIdentity; readonly id?: string; readonly slug?: string },
): StoredMemoryRecord | undefined => {
  const maps = [...records].filter(
    (record) => record.type === "work_map" && sameProject(record, input.identity),
  );
  if (input.id !== undefined) {
    return maps.find((record) => record.id === input.id);
  }
  if (input.slug === undefined) {
    return undefined;
  }
  const named = maps.filter((record) => text(record.extra, "user_slug") === input.slug);
  return (
    named.find((record) => text(record.extra, "workspace_key") === input.identity.workspaceKey) ??
    named.find(
      (record) => text(record.extra, "workspace_key") === input.identity.primaryWorkspaceKey,
    )
  );
};

const readOptions = (
  value: unknown,
): ReadonlyArray<{ readonly label: string; readonly context: string }> => {
  if (!Array.isArray(value)) {
    return [];
  }
  const options: Array<{ label: string; context: string }> = [];
  for (const item of value) {
    if (item === null || typeof item !== "object") {
      continue;
    }
    const label = (item as { label?: unknown }).label;
    const context = (item as { context?: unknown }).context;
    if (typeof label !== "string") {
      continue;
    }
    options.push({ label, context: typeof context === "string" ? context : "" });
  }
  return options;
};

export const presentMap = (
  map: StoredMemoryRecord,
  records: ReadonlyMap<string, StoredMemoryRecord>,
  edges: ReadonlyArray<StoredMemoryEdge>,
  view: "overview" | "full",
): MapReadResult => {
  const members = edges
    .filter((edge) => edge.verb === "contains" && edge.from === map.id)
    .map((edge) => ({
      edge,
      record: records.get(edge.to),
      ord: typeof edge.meta?.ord === "number" ? edge.meta.ord : 0,
    }))
    .filter(
      (member): member is typeof member & { record: StoredMemoryRecord } =>
        member.record !== undefined,
    )
    .sort((left, right) => left.ord - right.ord);

  const questions: Array<MapReadResult["questions"][number]> = [];
  const fog: Array<MapReadResult["fog"][number]> = [];
  const exclusions: Array<MapReadResult["exclusions"][number]> = [];
  for (const member of members) {
    const slug =
      typeof member.edge.meta?.slug === "string"
        ? member.edge.meta.slug
        : text(member.record.extra, "user_slug");
    const role = member.edge.meta?.role;
    if (role === "question") {
      questions.push(
        view === "full"
          ? {
              id: member.record.id,
              slug,
              title: member.record.title,
              wording: member.record.body,
              context: text(member.record.extra, "context"),
              options: readOptions(member.record.extra.options),
            }
          : { id: member.record.id, slug, title: member.record.title },
      );
    } else if (role === "fog") {
      fog.push(
        view === "full"
          ? { id: member.record.id, slug, title: member.record.title, body: member.record.body }
          : { id: member.record.id, slug, title: member.record.title },
      );
    } else if (role === "exclusion") {
      const reason = typeof member.edge.meta?.reason === "string" ? member.edge.meta.reason : "";
      exclusions.push(
        view === "full"
          ? {
              id: member.record.id,
              slug,
              title: member.record.title,
              reason,
              body: member.record.body,
            }
          : { id: member.record.id, slug, title: member.record.title, reason },
      );
    }
  }

  const repository = text(map.extra, "repository_key");
  const turn = text(map.extra, "source_turn_id");
  return {
    view,
    map: {
      id: map.id,
      title: map.title,
      destination: map.body,
      revision: revisionOf(map),
      ...(view === "full" ? { notes: text(map.extra, "notes") } : {}),
    },
    provenance: {
      environmentId: text(map.extra, "environment_id"),
      repositoryKey: repository.length === 0 ? null : repository,
      workspaceKey: text(map.extra, "workspace_key"),
      primaryWorkspaceKey: text(map.extra, "primary_workspace_key"),
      sourceThreadId: text(map.extra, "source_thread_id"),
      sourceTurnId: turn.length === 0 ? null : turn,
    },
    questions,
    fog,
    exclusions,
  };
};

export const planMapApply = (
  snapshot: MapSnapshot,
  input: MapApplyInput,
): Effect.Effect<MapPlan, MemoryToolError> =>
  Effect.gen(function* () {
    const key = input.idempotencyKey.trim();
    if (key.length === 0 || key.length > 200) {
      return yield* fail("invalid_slug", "idempotency_key must be 1 to 200 characters");
    }
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
      return yield* fail("type_mismatch", "expected_revision must be a non-negative integer");
    }
    const receiptId = receiptIdFor(key, input.identity);
    if (snapshot.receipt?.idempotencyKey === key) {
      return { kind: "replay", result: snapshot.receipt.result } as const;
    }
    yield* checkSlug(input.slug, "slug");
    if (input.title.trim().length === 0 || input.title.length > 200) {
      return yield* fail("type_mismatch", "title must be 1 to 200 characters");
    }
    if (input.destination.length === 0) {
      return yield* fail("type_mismatch", "destination is required");
    }
    for (const question of input.questions) {
      yield* checkSlug(question.slug, "question slug");
      if (question.title.trim().length === 0 || question.title.length > 200) {
        return yield* fail("type_mismatch", "question title must be 1 to 200 characters");
      }
      if (question.wording.length === 0) {
        return yield* fail("type_mismatch", "question wording is required");
      }
      for (const option of question.options) {
        if (option.label.length === 0) {
          return yield* fail("type_mismatch", "option label is required");
        }
      }
    }
    for (const patch of input.fog) {
      yield* checkSlug(patch.slug, "fog slug");
      if (patch.title.trim().length === 0 || patch.title.length > 200) {
        return yield* fail("type_mismatch", "fog title must be 1 to 200 characters");
      }
      if (patch.body.length === 0) {
        return yield* fail("type_mismatch", "fog body is required");
      }
    }
    for (const exclusion of input.exclusions) {
      yield* checkSlug(exclusion.slug, "exclusion slug");
      if (exclusion.title.trim().length === 0 || exclusion.title.length > 200) {
        return yield* fail("type_mismatch", "exclusion title must be 1 to 200 characters");
      }
      if (exclusion.reason.length === 0) {
        return yield* fail("type_mismatch", "exclusion reason is required");
      }
    }

    const mapId = mapRecordId(input.identity, input.slug);
    const existing = snapshot.records.get(mapId);
    const current = revisionOf(existing);
    if (current !== input.expectedRevision) {
      return yield* fail("revision_conflict", `current revision is ${current}`);
    }

    const seen = new Set<string>();
    for (const slug of [
      ...input.questions.map((question) => `q:${question.slug}`),
      ...input.fog.map((patch) => `f:${patch.slug}`),
      ...input.exclusions.map((exclusion) => `x:${exclusion.slug}`),
    ]) {
      if (seen.has(slug)) {
        return yield* fail("type_mismatch", `duplicate membership slug ${slug.slice(2)}`);
      }
      seen.add(slug);
    }

    const scope = mapScope(input.identity);
    const revision = current + 1;
    const upserts: StoredMemoryRecord[] = [];
    const edges: StoredMemoryEdge[] = [];
    const keep = new Set<string>();

    const workspaceId = workspaceProjectId(input.identity.workspaceKey);
    const primaryId = workspaceProjectId(input.identity.primaryWorkspaceKey);
    const projectNode = (id: string, workspaceKey: string): StoredMemoryRecord =>
      spine(
        id,
        "project",
        baseName(workspaceKey),
        "",
        "active",
        [`environment:${input.identity.environmentId}`, `workspace:${workspaceKey}`],
        { root_path: workspaceKey },
        snapshot.records.get(id),
      );
    upserts.push(projectNode(workspaceId, input.identity.workspaceKey));
    if (primaryId !== workspaceId) {
      upserts.push(projectNode(primaryId, input.identity.primaryWorkspaceKey));
    }

    upserts.push(
      spine(
        mapId,
        "work_map",
        input.title,
        input.destination,
        "open",
        scope,
        {
          destination: input.destination,
          notes: input.notes,
          revision,
          environment_id: input.identity.environmentId,
          repository_key: input.identity.repositoryKey ?? "",
          workspace_key: input.identity.workspaceKey,
          primary_workspace_key: input.identity.primaryWorkspaceKey,
          source_thread_id: input.identity.threadId,
          source_turn_id: input.identity.turnId ?? "",
          user_slug: input.slug,
        },
        existing,
      ),
    );

    const questions: Array<MapApplyResult["questions"][number]> = [];
    input.questions.forEach((question, index) => {
      const id = memberRecordId(input.identity, "q", question.slug, "question");
      keep.add(id);
      questions.push({ slug: question.slug, id });
      upserts.push(
        spine(
          id,
          "question",
          question.title,
          question.wording,
          "open",
          scope,
          {
            wording: question.wording,
            context: question.context,
            options: question.options.map((option) => ({
              label: option.label,
              context: option.context,
            })),
            user_slug: question.slug,
            map_id: mapId,
          },
          snapshot.records.get(id),
        ),
      );
      edges.push({
        from: mapId,
        verb: "contains",
        to: id,
        meta: { role: "question", reason: "", ord: index, slug: question.slug },
      });
    });

    const fog: Array<MapApplyResult["fog"][number]> = [];
    input.fog.forEach((patch, index) => {
      const id = memberRecordId(input.identity, "f", patch.slug, "thought");
      keep.add(id);
      fog.push({ slug: patch.slug, id });
      upserts.push(
        spine(
          id,
          "thought",
          patch.title,
          patch.body,
          "inbox",
          scope,
          { facet: "wayfinder-fog" },
          snapshot.records.get(id),
        ),
      );
      edges.push({
        from: mapId,
        verb: "contains",
        to: id,
        meta: { role: "fog", reason: "", ord: index, slug: patch.slug },
      });
    });

    const exclusions: Array<MapApplyResult["exclusions"][number]> = [];
    input.exclusions.forEach((exclusion, index) => {
      const id = memberRecordId(input.identity, "x", exclusion.slug, "thought");
      keep.add(id);
      exclusions.push({ slug: exclusion.slug, id });
      upserts.push(
        spine(
          id,
          "thought",
          exclusion.title,
          exclusion.body,
          "inbox",
          scope,
          { facet: "wayfinder-exclusion" },
          snapshot.records.get(id),
        ),
      );
      edges.push({
        from: mapId,
        verb: "contains",
        to: id,
        meta: { role: "exclusion", reason: exclusion.reason, ord: index, slug: exclusion.slug },
      });
    });

    const deleteIds = snapshot.edges
      .filter((edge) => edge.verb === "contains" && edge.from === mapId && !keep.has(edge.to))
      .map((edge) => edge.to);

    const linked = workspaceId !== primaryId;
    if (
      linked &&
      !snapshot.edges.some(
        (edge) => edge.verb === "worktree_of" && edge.from === workspaceId && edge.to === primaryId,
      )
    ) {
      edges.push({
        from: workspaceId,
        verb: "worktree_of",
        to: primaryId,
        meta: {
          workspace_key: input.identity.workspaceKey,
          repository_key: input.identity.repositoryKey ?? "",
        },
      });
    }

    const result: MapApplyResult = {
      mapId,
      revision,
      workspaceProjectId: workspaceId,
      primaryProjectId: primaryId,
      worktreeOf: linked ? primaryId : null,
      questions,
      fog,
      exclusions,
    };
    const receipt: MapReceipt = { idempotencyKey: key, result };
    return {
      kind: "commit",
      commit: { upserts, deleteIds, mapId, edges, receiptId, receipt, result },
    } as const;
  });
