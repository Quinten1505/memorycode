import { describe, expect, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { vi } from "vite-plus/test";

import { decodeMemoryConfig, MemoryConfig } from "./MemoryConfig.ts";
import { MemoryService, make, unavailableStore } from "./MemoryService.ts";

const rememberInput = {
  type: "decision",
  slug: "te0820-uio-not-mmap",
  title: "Expose TE0820 PL registers via UIO",
  scope: ["project:te0820-hil"],
};

describe("MemoryConfig", () => {
  it("reads SURREAL_* with defaults ns=harness db=memory", () => {
    expect(
      decodeMemoryConfig({
        SURREAL_URL: "ws://127.0.0.1:8000",
        SURREAL_USER: "root",
        SURREAL_PASS: "root",
      }),
    ).toEqual({
      url: "ws://127.0.0.1:8000",
      namespace: "harness",
      database: "memory",
      username: "root",
      password: "root",
      embedDim: 4096,
      autostart: true,
      dataDir: undefined,
      ollamaUrl: "http://127.0.0.1:11434",
      ollamaModel: "qwen3-embedding:8b-q4_K_M",
      ollamaAutostart: true,
    });
  });

  it("absent URL still autostarts a local backend", () => {
    expect(decodeMemoryConfig({}).url).toBeUndefined();
    expect(decodeMemoryConfig({}).autostart).toBe(true);
    expect(decodeMemoryConfig({ SURREAL_AUTOSTART: "0" }).autostart).toBe(false);
  });

  it("invalid EMBED_DIM defaults to 4096", () => {
    expect(decodeMemoryConfig({ EMBED_DIM: "abc" }).embedDim).toBe(4096);
    expect(decodeMemoryConfig({ EMBED_DIM: "-1" }).embedDim).toBe(4096);
  });

  it("defaults Ollama to local qwen3-embedding 8B", () => {
    const config = decodeMemoryConfig({});
    expect(config.ollamaUrl).toBe("http://127.0.0.1:11434");
    expect(config.ollamaModel).toBe("qwen3-embedding:8b-q4_K_M");
    expect(config.ollamaAutostart).toBe(true);
    expect(config.embedDim).toBe(4096);
  });
});

describe("MemoryService unavailable fallback", () => {
  it.effect("every unavailableStore method fails backend_unavailable", () =>
    Effect.gen(function* () {
      const errors = [
        yield* unavailableStore.remember(rememberInput).pipe(Effect.flip),
        yield* unavailableStore.get({ id: "decision:x" }).pipe(Effect.flip),
        yield* unavailableStore.status({ id: "decision:x", status: "accepted" }).pipe(Effect.flip),
        yield* unavailableStore
          .link({ from: "decision:x", verb: "about", to: "concept:y" })
          .pipe(Effect.flip),
        yield* unavailableStore
          .reclassify({ from: "thought:x", to_type: "decision", to_slug: "y" })
          .pipe(Effect.flip),
        yield* unavailableStore.recall({ query: "uio" }).pipe(Effect.flip),
        yield* unavailableStore.bootstrap({ project: "te0820-hil" }).pipe(Effect.flip),
        yield* unavailableStore
          .ingestTurn({
            threadId: "thread-x",
            turnId: "turn-x",
            projectSlug: "te0820-hil",
            provider: "grok",
            messages: [],
          })
          .pipe(Effect.flip),
        yield* unavailableStore
          .applyMap({
            idempotencyKey: "once",
            expectedRevision: 0,
            slug: "map",
            title: "Map",
            destination: "A destination",
            notes: "",
            identity: {
              environmentId: "env",
              repositoryKey: null,
              workspaceKey: "/work/app",
              primaryWorkspaceKey: "/work/app",
              threadId: "thread-x",
              turnId: null,
            },
            questions: [],
            fog: [],
            exclusions: [],
          })
          .pipe(Effect.flip),
        yield* unavailableStore
          .readMap({
            view: "overview",
            slug: "map",
            identity: {
              environmentId: "env",
              repositoryKey: null,
              workspaceKey: "/work/app",
              primaryWorkspaceKey: "/work/app",
              threadId: "thread-x",
              turnId: null,
            },
          })
          .pipe(Effect.flip),
      ];
      expect(errors.map((error) => error.error)).toEqual(Array(10).fill("backend_unavailable"));
    }),
  );

  it.effect("autostart disabled and no URL uses unavailableStore", () =>
    Effect.gen(function* () {
      const service = yield* MemoryService;
      const err = yield* service.store
        .get({ id: "decision:te0820-uio-not-mmap" })
        .pipe(Effect.flip);
      expect(err.error).toBe("backend_unavailable");
    }).pipe(
      Effect.provide(Layer.effect(MemoryService, make())),
      Effect.provide(
        Layer.succeed(
          MemoryConfig,
          MemoryConfig.of({
            url: undefined,
            namespace: "harness",
            database: "memory",
            username: undefined,
            password: undefined,
            embedDim: 4096,
            autostart: false,
            dataDir: undefined,
            ollamaUrl: "http://127.0.0.1:11434",
            ollamaModel: "qwen3-embedding:8b-q4_K_M",
            ollamaAutostart: false,
          }),
        ),
      ),
    ),
  );

  it.effect("autostart with no URL starts the local backend before connecting", () => {
    const ensure = vi.fn(async () => "started");
    const connect = vi.fn(async () => undefined);
    const query = vi.fn(async () => []);
    return Effect.gen(function* () {
      yield* MemoryService;
      expect(ensure).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "ws://127.0.0.1:8000",
          username: "root",
          password: "root",
          namespace: "harness",
          database: "memory",
        }),
      );
      expect(connect).toHaveBeenCalled();
    }).pipe(
      Effect.provide(
        Layer.effect(
          MemoryService,
          make(() => ({ connect, query }), ensure),
        ),
      ),
      Effect.provide(
        Layer.succeed(
          MemoryConfig,
          MemoryConfig.of({
            url: undefined,
            namespace: "harness",
            database: "memory",
            username: undefined,
            password: undefined,
            embedDim: 4096,
            autostart: true,
            dataDir: undefined,
            ollamaUrl: "http://127.0.0.1:11434",
            ollamaModel: "qwen3-embedding:8b-q4_K_M",
            ollamaAutostart: false,
          }),
        ),
      ),
    );
  });

  it.effect("autostart starts local Ollama with the embedding model", () => {
    const ensure = vi.fn(async () => "already-running");
    const ensureOllama = vi.fn(async () => "started");
    const connect = vi.fn(async () => undefined);
    const query = vi.fn(async () => []);
    return Effect.gen(function* () {
      yield* MemoryService;
      expect(ensureOllama).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "http://127.0.0.1:11434",
          model: "qwen3-embedding:8b-q4_K_M",
          dimensions: 4096,
        }),
      );
    }).pipe(
      Effect.provide(
        Layer.effect(
          MemoryService,
          make(() => ({ connect, query }), ensure, { ensureOllama }),
        ),
      ),
      Effect.provide(
        Layer.succeed(
          MemoryConfig,
          MemoryConfig.of({
            url: "ws://127.0.0.1:8000",
            namespace: "harness",
            database: "memory",
            username: "root",
            password: "root",
            embedDim: 4096,
            autostart: false,
            dataDir: undefined,
            ollamaUrl: "http://127.0.0.1:11434",
            ollamaModel: "qwen3-embedding:8b-q4_K_M",
            ollamaAutostart: true,
          }),
        ),
      ),
    );
  });

  it.effect("connect failure falls back to unavailableStore", () => {
    const connect = vi.fn(async () => {
      throw new Error("connection refused");
    });
    const query = vi.fn(async () => []);
    return Effect.gen(function* () {
      const service = yield* MemoryService;
      expect(connect).toHaveBeenCalled();
      expect(query).not.toHaveBeenCalled();
      const err = yield* service.store.remember(rememberInput).pipe(Effect.flip);
      expect(err.error).toBe("backend_unavailable");
    }).pipe(
      Effect.provide(
        Layer.effect(
          MemoryService,
          make(() => ({ connect, query })),
        ),
      ),
      Effect.provide(
        Layer.succeed(
          MemoryConfig,
          MemoryConfig.of({
            url: "ws://127.0.0.1:8000",
            namespace: "harness",
            database: "memory",
            username: "root",
            password: "root",
            embedDim: 4096,
            autostart: false,
            dataDir: undefined,
            ollamaUrl: "http://127.0.0.1:11434",
            ollamaModel: "qwen3-embedding:8b-q4_K_M",
            ollamaAutostart: false,
          }),
        ),
      ),
    );
  });
});

describe("MemoryConfig.layer", () => {
  it.effect("invalid EMBED_DIM does not fail the layer", () =>
    Effect.gen(function* () {
      const config = yield* MemoryConfig;
      expect(config.url).toBe("ws://127.0.0.1:8000");
      expect(config.embedDim).toBe(4096);
    }).pipe(
      Effect.provide(MemoryConfig.layer),
      Effect.provide(
        ConfigProvider.layer(
          ConfigProvider.fromEnv({
            env: {
              SURREAL_URL: "ws://127.0.0.1:8000",
              EMBED_DIM: "abc",
            },
          }),
        ),
      ),
    ),
  );

  it.effect("reads the same defaults from env", () =>
    Effect.gen(function* () {
      const config = yield* MemoryConfig;
      expect(config).toEqual({
        url: "ws://127.0.0.1:8000",
        namespace: "harness",
        database: "memory",
        username: "root",
        password: "root",
        embedDim: 4096,
        autostart: true,
        dataDir: undefined,
        ollamaUrl: "http://127.0.0.1:11434",
        ollamaModel: "qwen3-embedding:8b-q4_K_M",
        ollamaAutostart: true,
      });
    }).pipe(
      Effect.provide(MemoryConfig.layer),
      Effect.provide(
        ConfigProvider.layer(
          ConfigProvider.fromEnv({
            env: {
              SURREAL_URL: "ws://127.0.0.1:8000",
              SURREAL_USER: "root",
              SURREAL_PASS: "root",
            },
          }),
        ),
      ),
    ),
  );
});
