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
      embedDim: 1536,
    });
  });

  it("absent URL means unconfigured", () => {
    expect(decodeMemoryConfig({}).url).toBeUndefined();
  });

  it("invalid EMBED_DIM defaults to 1536", () => {
    expect(decodeMemoryConfig({ EMBED_DIM: "abc" }).embedDim).toBe(1536);
    expect(decodeMemoryConfig({ EMBED_DIM: "-1" }).embedDim).toBe(1536);
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
      ];
      expect(errors.map((error) => error.error)).toEqual(Array(7).fill("backend_unavailable"));
    }),
  );

  it.effect("no SURREAL_URL uses unavailableStore", () =>
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
            embedDim: 1536,
          }),
        ),
      ),
    ),
  );

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
            embedDim: 1536,
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
      expect(config.embedDim).toBe(1536);
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
        embedDim: 1536,
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
