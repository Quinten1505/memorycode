import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { McpServer } from "effect/unstable/ai";

import { MemoryToolError } from "../../../memory/errors.ts";
import { normalizeWorkspaceKey } from "../../../memory/mapApply.ts";
import { MemoryService } from "../../../memory/MemoryService.ts";
import type { MapApplyResult, MapIdentity, MapReadResult } from "../../../memory/MemoryStore.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { MemoryToolkit, type MemoryErrorResult } from "./tools.ts";

const DEFAULT_AUTHORED_BY = "agent:harness";

const errorResult = (error: MemoryToolError): MemoryErrorResult =>
  error.hint === undefined ? { error: error.error } : { error: error.error, hint: error.hint };

const asToolResult = <A>(effect: Effect.Effect<A, MemoryToolError>) =>
  effect.pipe(Effect.catchTag("MemoryToolError", (error) => Effect.succeed(errorResult(error))));

const make = Effect.gen(function* () {
  const memory = yield* MemoryService;
  const snapshots = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;

  const defaultProjectSlug = Effect.fn("MemoryToolkit.defaultProjectSlug")(function* () {
    const scope = yield* McpInvocationContext.McpInvocationContext;
    const thread = yield* snapshots
      .getThreadShellById(scope.threadId)
      .pipe(Effect.orElseSucceed(() => Option.none()));
    if (Option.isNone(thread)) {
      return undefined;
    }
    const project = yield* snapshots
      .getProjectShellById(thread.value.projectId)
      .pipe(Effect.orElseSucceed(() => Option.none()));
    if (Option.isNone(project) || project.value.workspaceRoot.length === 0) {
      return undefined;
    }
    return NodePath.basename(project.value.workspaceRoot).toLowerCase();
  });

  const currentIdentity = Effect.fn("MemoryToolkit.currentIdentity")(function* () {
    const scope = yield* McpInvocationContext.McpInvocationContext;
    const thread = yield* snapshots
      .getThreadShellById(scope.threadId)
      .pipe(Effect.orElseSucceed(() => Option.none()));
    if (Option.isNone(thread)) {
      return undefined;
    }
    const project = yield* snapshots
      .getProjectShellById(thread.value.projectId)
      .pipe(Effect.orElseSucceed(() => Option.none()));
    if (Option.isNone(project) || project.value.workspaceRoot.length === 0) {
      return undefined;
    }
    const primary = project.value.repositoryIdentity?.rootPath ?? project.value.workspaceRoot;
    const workspace = thread.value.worktreePath ?? project.value.workspaceRoot;
    const identity: MapIdentity = {
      environmentId: scope.environmentId,
      repositoryKey: project.value.repositoryIdentity?.canonicalKey ?? null,
      workspaceKey: normalizeWorkspaceKey(workspace),
      primaryWorkspaceKey: normalizeWorkspaceKey(primary),
      threadId: scope.threadId,
      turnId: thread.value.latestTurn?.turnId ?? null,
    };
    return identity;
  });

  const applyPayload = (result: MapApplyResult) => ({
    map_id: result.mapId,
    revision: result.revision,
    workspace_project_id: result.workspaceProjectId,
    primary_project_id: result.primaryProjectId,
    worktree_of: result.worktreeOf,
    questions: result.questions,
    fog: result.fog,
    exclusions: result.exclusions,
  });

  const readPayload = (result: MapReadResult) => ({
    view: result.view,
    map: {
      id: result.map.id,
      title: result.map.title,
      destination: result.map.destination,
      revision: result.map.revision,
      ...(result.map.notes === undefined ? {} : { notes: result.map.notes }),
    },
    provenance: {
      environment_id: result.provenance.environmentId,
      repository_key: result.provenance.repositoryKey,
      workspace_key: result.provenance.workspaceKey,
      primary_workspace_key: result.provenance.primaryWorkspaceKey,
      source_thread_id: result.provenance.sourceThreadId,
      source_turn_id: result.provenance.sourceTurnId,
    },
    questions: result.questions,
    fog: result.fog,
    exclusions: result.exclusions,
  });

  return MemoryToolkit.of({
    memory_bootstrap: (input) =>
      Effect.gen(function* () {
        yield* McpInvocationContext.requireMcpCapability("memory");
        const project = input.project ?? (yield* defaultProjectSlug());
        if (project === undefined || project.length === 0) {
          return {
            error: "scope_required",
            hint: "Pass project slug.",
          } satisfies MemoryErrorResult;
        }
        return yield* asToolResult(
          memory.store.bootstrap({
            project,
            ...(input.max_tokens === undefined ? {} : { max_tokens: input.max_tokens }),
            ...(input.include_inbox === undefined ? {} : { include_inbox: input.include_inbox }),
          }),
        );
      }),
    memory_recall: (input) =>
      Effect.gen(function* () {
        yield* McpInvocationContext.requireMcpCapability("memory");
        return yield* asToolResult(
          memory.store.recall({
            query: input.query,
            ...(input.project === undefined ? {} : { project: input.project }),
            ...(input.types === undefined ? {} : { types: input.types }),
            ...(input.k === undefined ? {} : { k: input.k }),
            ...(input.include_proposed === undefined
              ? {}
              : { include_proposed: input.include_proposed }),
          }),
        );
      }),
    memory_get: (input) =>
      Effect.gen(function* () {
        yield* McpInvocationContext.requireMcpCapability("memory");
        return yield* asToolResult(memory.store.get({ id: input.id }));
      }),
    memory_remember: (input) =>
      Effect.gen(function* () {
        yield* McpInvocationContext.requireMcpCapability("memory");
        return yield* asToolResult(
          memory.store.remember({
            type: input.type,
            slug: input.slug,
            title: input.title,
            scope: input.scope,
            authoredBy: DEFAULT_AUTHORED_BY,
            ...(input.body === undefined ? {} : { body: input.body }),
            ...(input.tags === undefined ? {} : { tags: input.tags }),
            ...(input.extra === undefined ? {} : { extra: input.extra }),
            ...(input.links === undefined ? {} : { links: input.links }),
            ...(input.confirm === undefined ? {} : { confirm: input.confirm }),
          }),
        );
      }),
    memory_link: (input) =>
      Effect.gen(function* () {
        yield* McpInvocationContext.requireMcpCapability("memory");
        return yield* asToolResult(
          memory.store.link({
            from: input.from,
            verb: input.verb,
            to: input.to,
            ...(input.meta === undefined ? {} : { meta: input.meta }),
          }),
        );
      }),
    memory_status: (input) =>
      Effect.gen(function* () {
        yield* McpInvocationContext.requireMcpCapability("memory");
        return yield* asToolResult(
          memory.store.status({
            id: input.id,
            status: input.status,
            ...(input.successor === undefined ? {} : { successor: input.successor }),
            ...(input.reason === undefined ? {} : { reason: input.reason }),
            ...(input.confirm === undefined ? {} : { confirm: input.confirm }),
          }),
        );
      }),
    memory_reclassify: (input) =>
      Effect.gen(function* () {
        yield* McpInvocationContext.requireMcpCapability("memory");
        return yield* asToolResult(
          memory.store.reclassify({
            from: input.from,
            to_type: input.to_type,
            to_slug: input.to_slug,
            ...(input.title === undefined ? {} : { title: input.title }),
            ...(input.body === undefined ? {} : { body: input.body }),
            ...(input.extra === undefined ? {} : { extra: input.extra }),
            ...(input.links === undefined ? {} : { links: input.links }),
            ...(input.confirm === undefined ? {} : { confirm: input.confirm }),
          }),
        );
      }),
    memory_map_apply: (input) =>
      Effect.gen(function* () {
        yield* McpInvocationContext.requireMcpCapability("memory");
        const identity = yield* currentIdentity();
        if (identity === undefined) {
          return {
            error: "scope_required",
            hint: "Thread workspace is required to save a map.",
          } satisfies MemoryErrorResult;
        }
        return yield* asToolResult(
          memory.store
            .applyMap({
              idempotencyKey: input.idempotency_key,
              expectedRevision: input.expected_revision,
              slug: input.slug,
              title: input.title,
              destination: input.destination,
              notes: input.notes,
              identity,
              questions: input.questions.map((question) => ({
                slug: question.slug,
                title: question.title,
                wording: question.wording,
                context: question.context ?? "",
                options: (question.options ?? []).map((option) => ({
                  label: option.label,
                  context: option.context ?? "",
                })),
              })),
              fog: input.fog,
              exclusions: input.exclusions,
            })
            .pipe(Effect.map(applyPayload)),
        );
      }),
    memory_map_get: (input) =>
      Effect.gen(function* () {
        yield* McpInvocationContext.requireMcpCapability("memory");
        const identity = yield* currentIdentity();
        if (identity === undefined) {
          return {
            error: "scope_required",
            hint: "Thread workspace is required to read a map.",
          } satisfies MemoryErrorResult;
        }
        return yield* asToolResult(
          memory.store
            .readMap({
              identity,
              view: input.view ?? "overview",
              ...(input.id === undefined ? {} : { id: input.id }),
              ...(input.slug === undefined ? {} : { slug: input.slug }),
            })
            .pipe(Effect.map(readPayload)),
        );
      }),
  });
});

export const MemoryToolkitHandlersLive = MemoryToolkit.toLayer(make);

export const MemoryToolkitRegistrationLive = McpServer.toolkit(MemoryToolkit).pipe(
  Layer.provide(MemoryToolkitHandlersLive),
);
