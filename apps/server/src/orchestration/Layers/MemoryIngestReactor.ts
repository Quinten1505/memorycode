import { type ProviderRuntimeEvent } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as NodePath from "node:path";

import { MemoryService } from "../../memory/MemoryService.ts";
import type { IngestMessage } from "../../memory/MemoryStore.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { forkParked } from "../../serverActivation.ts";
import {
  MemoryIngestReactor,
  type MemoryIngestReactorShape,
} from "../Services/MemoryIngestReactor.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { RuntimeReceiptBus } from "../Services/RuntimeReceiptBus.ts";

const projectSlugFromRoot = (workspaceRoot: string): string =>
  NodePath.basename(workspaceRoot).toLowerCase();

const make = Effect.gen(function* () {
  const memory = yield* MemoryService;
  const snapshots = yield* ProjectionSnapshotQuery;
  const providerService = yield* ProviderService;
  const receipts = yield* RuntimeReceiptBus;

  const ingestCompletedTurn = Effect.fn("MemoryIngestReactor.ingestCompletedTurn")(function* (
    event: Extract<ProviderRuntimeEvent, { type: "turn.completed" }>,
  ) {
    const turnId = event.turnId;
    if (turnId === undefined || turnId.length === 0) {
      return;
    }
    const detail = yield* snapshots.getThreadDetailSnapshot(event.threadId);
    if (Option.isNone(detail)) {
      return;
    }
    const thread = detail.value.thread;
    const project = yield* snapshots.getProjectShellById(thread.projectId);
    const workspaceRoot = Option.isSome(project) ? project.value.workspaceRoot : "";
    const projectSlug = workspaceRoot.length > 0 ? projectSlugFromRoot(workspaceRoot) : "unknown";
    const messages: IngestMessage[] = thread.messages.map((message) => ({
      role: message.role,
      text: message.text,
      turnId: message.turnId,
    }));
    const result = yield* memory.store.ingestTurn({
      threadId: event.threadId,
      turnId,
      projectSlug,
      provider: event.provider,
      messages,
    });
    yield* receipts.publish({
      type: "memory.ingest.completed",
      threadId: event.threadId,
      turnId,
      observationCount: result.observationIds.length,
      promotedCount: result.promotedIds.length,
    });
  });

  const processSafely = (event: Extract<ProviderRuntimeEvent, { type: "turn.completed" }>) =>
    ingestCompletedTurn(event).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("memory ingest skipped; turn still complete", {
          threadId: event.threadId,
          turnId: event.turnId,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processSafely);

  const start: MemoryIngestReactorShape["start"] = Effect.fn("MemoryIngestReactor.start")(
    function* () {
      yield* forkParked(
        Stream.runForEach(providerService.streamEvents, (event) => {
          if (event.type !== "turn.completed") {
            return Effect.void;
          }
          return worker.enqueue(event);
        }),
      );
    },
  );

  return { start, drain: worker.drain } satisfies MemoryIngestReactorShape;
});

export const MemoryIngestReactorLive = Layer.effect(MemoryIngestReactor, make);
