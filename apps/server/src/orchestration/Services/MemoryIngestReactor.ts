import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export interface MemoryIngestReactorShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  readonly drain: Effect.Effect<void>;
}

export class MemoryIngestReactor extends Context.Service<
  MemoryIngestReactor,
  MemoryIngestReactorShape
>()("t3/orchestration/Services/MemoryIngestReactor") {}
