import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationProjectShell,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import type { Tool } from "effect/unstable/ai";

import { makeInMemoryMemoryStore } from "../../../memory/InMemoryMemoryStore.ts";
import { MemoryService, unavailableStore } from "../../../memory/MemoryService.ts";
import type { BootstrapInput, MemoryStore } from "../../../memory/MemoryStore.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { MemoryToolkitHandlersLive } from "./handlers.ts";
import { MemoryToolkit } from "./tools.ts";

const PROJECT_ID = ProjectId.make("project-1");
const THREAD_ID = ThreadId.make("thread-1");

const invocation = (
  capabilities: ReadonlyArray<McpInvocationContext.McpCapability>,
): McpInvocationContext.McpInvocationScope => ({
  environmentId: EnvironmentId.make("environment-1"),
  threadId: THREAD_ID,
  providerSessionId: "provider-session-1",
  providerInstanceId: ProviderInstanceId.make("codex"),
  capabilities: new Set(capabilities),
  issuedAt: 1,
});

function makeProject(workspaceRoot = "/workspace/te0820-hil"): OrchestrationProjectShell {
  return {
    id: PROJECT_ID,
    title: "Project",
    workspaceRoot,
    defaultModelSelection: null,
    scripts: [],
    repositoryIdentity: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

function makeThread(): OrchestrationThreadShell {
  return {
    id: THREAD_ID,
    projectId: PROJECT_ID,
    title: "Thread",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    pullRequests: [],
    latestTurn: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: "2026-08-20T00:00:00.000Z",
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  };
}

interface HarnessOptions {
  readonly thread?: OrchestrationThreadShell | null;
  readonly project?: OrchestrationProjectShell | null;
  readonly store?: MemoryStore;
}

const makeHarness = Effect.fn("makeMemoryToolkitHarness")(function* (options: HarnessOptions = {}) {
  const thread = options.thread === undefined ? makeThread() : options.thread;
  const project = options.project === undefined ? makeProject() : options.project;
  const inner = options.store ?? makeInMemoryMemoryStore();
  const bootstrapCalls = yield* Ref.make<ReadonlyArray<BootstrapInput>>([]);
  const statusCalls = yield* Ref.make<
    ReadonlyArray<{
      readonly id: string;
      readonly status: string;
      readonly successor?: string;
      readonly reason?: string;
      readonly confirm?: boolean;
    }>
  >([]);
  const store: MemoryStore = {
    ...inner,
    bootstrap: (input) =>
      Ref.update(bootstrapCalls, (recorded) => [...recorded, input]).pipe(
        Effect.andThen(inner.bootstrap(input)),
      ),
    status: (input) =>
      Ref.update(statusCalls, (recorded) => [...recorded, input]).pipe(
        Effect.andThen(inner.status(input)),
      ),
  };
  const dependencies = Layer.mergeAll(
    Layer.mock(ProjectionSnapshotQuery)({
      getThreadShellById: (threadId) =>
        Effect.succeed(threadId === THREAD_ID ? Option.fromNullishOr(thread) : Option.none()),
      getProjectShellById: () => Effect.succeed(Option.fromNullishOr(project)),
    }),
    Layer.succeed(MemoryService, MemoryService.of({ store })),
  );
  const toolkit = yield* MemoryToolkit.pipe(
    Effect.provide(MemoryToolkitHandlersLive.pipe(Layer.provide(dependencies))),
  );
  const call = <Name extends keyof typeof MemoryToolkit.tools>(
    name: Name,
    params: Parameters<typeof toolkit.handle<Name>>[1],
    capabilities: ReadonlyArray<McpInvocationContext.McpCapability> = ["memory"],
  ) =>
    toolkit.handle(name, params).pipe(
      Stream.unwrap,
      Stream.runCollect,
      Effect.map(
        (chunk) => chunk.at(-1)!.result as Tool.Success<(typeof MemoryToolkit.tools)[Name]>,
      ),
      Effect.provideService(McpInvocationContext.McpInvocationContext, invocation(capabilities)),
      Effect.provide(dependencies),
    );
  return { bootstrapCalls, statusCalls, call };
});

describe("memory toolkit handlers", () => {
  it.effect("refuses a credential without the memory capability", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const error = yield* harness.call("memory_bootstrap", {}, ["preview"]).pipe(Effect.flip);
      expect(error).toMatchObject({
        _tag: "McpCapabilityUnavailableError",
        capability: "memory",
        threadId: THREAD_ID,
      });
    }),
  );

  it.effect("defaults memory_bootstrap project to the workspace basename", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.call("memory_bootstrap", {});
      expect(yield* Ref.get(harness.bootstrapCalls)).toEqual([{ project: "te0820-hil" }]);
    }),
  );

  it.effect("memory_remember success returns a card", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const result = yield* harness.call("memory_remember", {
        type: "decision",
        slug: "te0820-uio-not-mmap",
        title: "Expose TE0820 PL registers via UIO",
        body: "No /dev/mem.",
        scope: ["project:te0820-hil", "domain:hw"],
      });
      expect(result).toMatchObject({
        card: {
          id: "decision:te0820-uio-not-mmap",
          type: "decision",
          title: "Expose TE0820 PL registers via UIO",
          status: "proposed",
        },
      });
    }),
  );

  it.effect("maps store backend_unavailable into the success payload", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ store: unavailableStore });
      const result = yield* harness.call("memory_get", { id: "decision:missing-card" });
      expect(result).toEqual({ error: "backend_unavailable" });
    }),
  );

  it.effect("memory_get missing id returns not_found in the success payload", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const result = yield* harness.call("memory_get", { id: "decision:does-not-exist" });
      expect(result).toEqual({ error: "not_found" });
    }),
  );

  it.effect("memory_bootstrap without a project or workspace asks for a slug", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ thread: null });
      const result = yield* harness.call("memory_bootstrap", {});
      expect(result).toEqual({ error: "scope_required", hint: "Pass project slug." });
      expect(yield* Ref.get(harness.bootstrapCalls)).toEqual([]);
    }),
  );

  it.effect("forwards confirm only when the tool argument sets it", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.call("memory_remember", {
        type: "constraint",
        slug: "no-mmap",
        title: "No /dev/mem",
        scope: ["project:te0820-hil"],
        extra: { severity: "blocker" },
      });
      yield* harness.call("memory_status", { id: "constraint:no-mmap", status: "active" });
      yield* harness.call("memory_status", {
        id: "constraint:no-mmap",
        status: "active",
        confirm: true,
      });
      expect(yield* Ref.get(harness.statusCalls)).toEqual([
        { id: "constraint:no-mmap", status: "active" },
        { id: "constraint:no-mmap", status: "active", confirm: true },
      ]);
    }),
  );
});
