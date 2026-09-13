import { describe, expect, it } from "@effect/vitest";

import {
  bindAddressFor,
  DEFAULT_LOCAL_URL,
  ensureLocalSurreal,
  healthUrlFor,
  isLoopbackUrl,
  storageUrlFor,
  surrealStartArgs,
} from "./ensureLocalSurreal.ts";

describe("local Surreal targeting", () => {
  it("treats loopback URLs as local", () => {
    expect(isLoopbackUrl("ws://127.0.0.1:8000")).toBe(true);
    expect(isLoopbackUrl("http://localhost:8000")).toBe(true);
    expect(isLoopbackUrl("wss://db.example.com")).toBe(false);
  });

  it("maps a websocket URL to the HTTP health endpoint", () => {
    expect(bindAddressFor(DEFAULT_LOCAL_URL)).toBe("127.0.0.1:8000");
    expect(healthUrlFor(DEFAULT_LOCAL_URL)).toBe("http://127.0.0.1:8000/health");
  });

  it("builds a surrealkv path with forward slashes", () => {
    expect(storageUrlFor("C:\\Users\\Quinten\\.t3\\memory\\db")).toBe(
      "surrealkv://C:/Users/Quinten/.t3/memory/db",
    );
  });
});

describe("ensureLocalSurreal", () => {
  it("skips spawn when health already succeeds", async () => {
    const spawn = () => {
      throw new Error("should not spawn");
    };
    const status = await ensureLocalSurreal(
      {
        url: DEFAULT_LOCAL_URL,
        username: "root",
        password: "root",
        namespace: "harness",
        database: "memory",
        dataDir: "/tmp/memory-db",
      },
      {
        fetch: async () => new Response(null, { status: 200 }),
        spawn,
        commandPath: "/usr/bin/surreal",
      },
    );
    expect(status).toBe("already-running");
  });

  it("spawns surreal start and waits until healthy", async () => {
    const spawned: Array<{ command: string; args: ReadonlyArray<string> }> = [];
    let healthy = false;
    const status = await ensureLocalSurreal(
      {
        url: DEFAULT_LOCAL_URL,
        username: "root",
        password: "root",
        namespace: "harness",
        database: "memory",
        dataDir: "/tmp/memory-db",
      },
      {
        fetch: async () => new Response(null, { status: healthy ? 200 : 503 }),
        spawn: (command, args) => {
          spawned.push({ command, args });
          healthy = true;
          return { unref() {} };
        },
        mkdir: async () => undefined,
        sleep: async () => undefined,
        now: (() => {
          let tick = 0;
          return () => {
            tick += 1;
            return tick;
          };
        })(),
        commandPath: "C:\\Users\\Quinten\\AppData\\Local\\SurrealDB\\surreal.exe",
      },
    );
    expect(status).toBe("started");
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.command).toContain("surreal");
    expect(spawned[0]?.args).toEqual(
      surrealStartArgs({
        bind: "127.0.0.1:8000",
        username: "root",
        password: "root",
        namespace: "harness",
        database: "memory",
        dataDir: "/tmp/memory-db",
      }),
    );
  });

  it("does not spawn for a remote URL", async () => {
    const status = await ensureLocalSurreal(
      {
        url: "wss://db.example.com",
        username: "root",
        password: "root",
        namespace: "harness",
        database: "memory",
        dataDir: "/tmp/memory-db",
      },
      {
        spawn: () => {
          throw new Error("should not spawn");
        },
      },
    );
    expect(status).toBe("skipped");
  });
});
