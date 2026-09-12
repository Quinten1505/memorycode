import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Surreal } from "surrealdb";

import { MemoryToolError } from "./errors.ts";
import { MemoryConfig } from "./MemoryConfig.ts";
import type { MemoryStore } from "./MemoryStore.ts";
import { renderMemorySchema } from "./renderSchema.ts";
import { makeSurrealMemoryStore, type MemorySurrealClient } from "./SurrealMemoryStore.ts";

export type MemorySurrealFactory = () => MemorySurrealClient;

const unavailable = () => Effect.fail(new MemoryToolError({ error: "backend_unavailable" }));

/** Fails every MemoryStore method with backend_unavailable. */
export const unavailableStore: MemoryStore = {
  remember: () => unavailable(),
  get: () => unavailable(),
  status: () => unavailable(),
  link: () => unavailable(),
  reclassify: () => unavailable(),
  recall: () => unavailable(),
  bootstrap: () => unavailable(),
};

const openStore = async (
  url: string,
  config: MemoryConfig["Service"],
  createSurreal: MemorySurrealFactory,
): Promise<MemoryStore> => {
  const db = createSurreal();
  const authentication =
    config.username !== undefined && config.password !== undefined
      ? { username: config.username, password: config.password }
      : undefined;
  await db.connect(url, {
    namespace: config.namespace,
    database: config.database,
    ...(authentication === undefined ? {} : { authentication }),
  });
  const applied = db.query(
    renderMemorySchema({
      embedDim: config.embedDim,
      namespace: config.namespace,
      database: config.database,
    }),
  );
  if (
    applied !== null &&
    typeof applied === "object" &&
    "collect" in applied &&
    typeof (applied as { collect?: unknown }).collect === "function"
  ) {
    await (applied as { collect: () => Promise<unknown> }).collect();
  } else {
    await applied;
  }
  return makeSurrealMemoryStore(db);
};

/** @public Service construction is part of the canonical Effect module API. */
export const make = (createSurreal: MemorySurrealFactory = () => new Surreal()) =>
  Effect.gen(function* () {
    const config = yield* MemoryConfig;
    if (config.url === undefined) {
      yield* Effect.logInfo("memory MCP tools are registered but have no backend");
      return MemoryService.of({ store: unavailableStore });
    }
    const url = config.url;
    const store = yield* Effect.tryPromise({
      try: () => openStore(url, config, createSurreal),
      catch: (cause) => (cause instanceof Error ? cause : new Error("surreal connect failed")),
    }).pipe(
      Effect.tapError((cause) =>
        Effect.logWarning("Surreal memory backend unavailable; falling back to disabled store", {
          cause,
        }),
      ),
      Effect.orElseSucceed(() => unavailableStore),
    );
    return MemoryService.of({ store });
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.gen(function* () {
        yield* Effect.logWarning(
          "Surreal memory backend unavailable; falling back to disabled store",
          { cause },
        );
        return MemoryService.of({ store: unavailableStore });
      }),
    ),
  );

export class MemoryService extends Context.Service<
  MemoryService,
  {
    readonly store: MemoryStore;
  }
>()("t3/memory/MemoryService") {
  static readonly layer = Layer.effect(MemoryService, make()).pipe(
    Layer.provide(MemoryConfig.layer),
  );
}
