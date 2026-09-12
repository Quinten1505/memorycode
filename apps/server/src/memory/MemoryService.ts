import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Surreal } from "surrealdb";

import {
  DEFAULT_LOCAL_PASS,
  DEFAULT_LOCAL_URL,
  DEFAULT_LOCAL_USER,
  defaultMemoryDataDir,
  ensureLocalSurreal,
  isLoopbackUrl,
} from "./ensureLocalSurreal.ts";
import { MemoryToolError } from "./errors.ts";
import { MemoryConfig, type MemoryConfigValue } from "./MemoryConfig.ts";
import type { MemoryStore } from "./MemoryStore.ts";
import { renderMemorySchema } from "./renderSchema.ts";
import { makeSurrealMemoryStore, type MemorySurrealClient } from "./SurrealMemoryStore.ts";

export type MemorySurrealFactory = () => MemorySurrealClient;

export type EnsureLocalSurreal = (
  input: Parameters<typeof ensureLocalSurreal>[0],
) => Promise<unknown>;

const resolvedBackend = (config: MemoryConfigValue) => {
  const url = config.url ?? (config.autostart ? DEFAULT_LOCAL_URL : undefined);
  if (url === undefined) {
    return undefined;
  }
  return {
    url,
    namespace: config.namespace,
    database: config.database,
    username: config.username ?? DEFAULT_LOCAL_USER,
    password: config.password ?? DEFAULT_LOCAL_PASS,
    embedDim: config.embedDim,
    dataDir: config.dataDir ?? defaultMemoryDataDir(),
    autostart: config.autostart,
  };
};

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
export const make = (
  createSurreal: MemorySurrealFactory = () => new Surreal(),
  ensureLocal?: EnsureLocalSurreal,
) =>
  Effect.gen(function* () {
    const config = yield* MemoryConfig;
    const backend = resolvedBackend(config);
    if (backend === undefined) {
      yield* Effect.logInfo("memory MCP tools are registered but have no backend");
      return MemoryService.of({ store: unavailableStore });
    }
    if (backend.autostart && isLoopbackUrl(backend.url)) {
      const localInput = {
        url: backend.url,
        username: backend.username,
        password: backend.password,
        namespace: backend.namespace,
        database: backend.database,
        dataDir: backend.dataDir,
      };
      yield* Effect.tryPromise({
        try: () =>
          ensureLocal !== undefined
            ? ensureLocal(localInput)
            : ensureLocalSurreal(localInput, { commandPath: "surreal" }),
        catch: (cause) => (cause instanceof Error ? cause : new Error("surreal start failed")),
      }).pipe(
        Effect.tapError((cause) =>
          Effect.logWarning("Could not autostart local SurrealDB", { cause }),
        ),
        Effect.ignore,
      );
    }
    const url = backend.url;
    const store = yield* Effect.tryPromise({
      try: () =>
        openStore(
          url,
          {
            ...config,
            url,
            username: backend.username,
            password: backend.password,
          },
          createSurreal,
        ),
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
