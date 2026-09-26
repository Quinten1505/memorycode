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
import { ensureLocalOllama } from "./ensureLocalOllama.ts";
import { MemoryToolError } from "./errors.ts";
import { MemoryConfig, type MemoryConfigValue } from "./MemoryConfig.ts";
import type { MemoryStore } from "./MemoryStore.ts";
import { makeOllamaEmbedder, type MemoryEmbedder } from "./ollamaEmbed.ts";
import { renderMemorySchema, renderWayfinderMigration } from "./renderSchema.ts";
import { makeSurrealMemoryStore, type MemorySurrealClient } from "./SurrealMemoryStore.ts";

export type MemorySurrealFactory = () => MemorySurrealClient;

export type EnsureLocalSurreal = (
  input: Parameters<typeof ensureLocalSurreal>[0],
) => Promise<unknown>;

export type EnsureLocalOllama = (
  input: Parameters<typeof ensureLocalOllama>[0],
) => Promise<unknown>;

export type MemoryServiceHooks = {
  readonly ensureOllama?: EnsureLocalOllama;
  readonly embedder?: MemoryEmbedder;
};

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
  ingestTurn: () => unavailable(),
  applyMap: () => unavailable(),
  readMap: () => unavailable(),
};

const openStore = async (
  url: string,
  config: MemoryConfig["Service"],
  createSurreal: MemorySurrealFactory,
  embedder?: MemoryEmbedder,
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
  const settle = async (applied: unknown) => {
    if (
      applied !== null &&
      typeof applied === "object" &&
      "collect" in applied &&
      typeof (applied as { collect?: unknown }).collect === "function"
    ) {
      await (applied as { collect: () => Promise<unknown> }).collect();
      return;
    }
    await applied;
  };
  await settle(
    db.query(
      renderMemorySchema({
        embedDim: config.embedDim,
        namespace: config.namespace,
        database: config.database,
      }),
    ),
  );
  await settle(
    db.query(
      renderWayfinderMigration({
        embedDim: config.embedDim,
        namespace: config.namespace,
        database: config.database,
      }),
    ),
  );
  return makeSurrealMemoryStore(db, embedder);
};

/** @public Service construction is part of the canonical Effect module API. */
export const make = (
  createSurreal: MemorySurrealFactory = () => new Surreal(),
  ensureLocal?: EnsureLocalSurreal,
  hooks: MemoryServiceHooks = {},
) =>
  Effect.gen(function* () {
    const config = yield* MemoryConfig;
    const backend = resolvedBackend(config);
    if (backend === undefined) {
      yield* Effect.logInfo("memory MCP tools are registered but have no backend");
      return MemoryService.of({ store: unavailableStore });
    }
    if (config.ollamaAutostart && isLoopbackUrl(config.ollamaUrl)) {
      yield* Effect.tryPromise({
        try: () =>
          (hooks.ensureOllama ?? ensureLocalOllama)({
            url: config.ollamaUrl,
            model: config.ollamaModel,
            dimensions: config.embedDim,
          }),
        catch: (cause) => (cause instanceof Error ? cause : new Error("ollama start failed")),
      }).pipe(
        Effect.tapError((cause) =>
          Effect.logWarning("Could not autostart local Ollama embedder", { cause }),
        ),
        Effect.ignore,
      );
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
    const embedder =
      hooks.embedder ??
      makeOllamaEmbedder({
        url: config.ollamaUrl,
        model: config.ollamaModel,
        dimensions: config.embedDim,
      });
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
          embedder,
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
