import { describe, expect, it } from "@effect/vitest";

import {
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_OLLAMA_URL,
  ensureLocalOllama,
  modelIsListed,
  ollamaTagsUrl,
} from "./ensureLocalOllama.ts";

describe("local Ollama targeting", () => {
  it("maps loopback URLs to /api/tags", () => {
    expect(ollamaTagsUrl(DEFAULT_OLLAMA_URL)).toBe("http://127.0.0.1:11434/api/tags");
    expect(ollamaTagsUrl("http://localhost:11434")).toBe("http://127.0.0.1:11434/api/tags");
    expect(ollamaTagsUrl("https://ollama.example.com")).toBeUndefined();
  });

  it("matches listed model names", () => {
    expect(modelIsListed([{ name: DEFAULT_OLLAMA_MODEL }], DEFAULT_OLLAMA_MODEL)).toBe(true);
    expect(modelIsListed([{ model: "qwen3-embedding:8b-q4_K_M" }], DEFAULT_OLLAMA_MODEL)).toBe(
      true,
    );
    expect(modelIsListed([{ name: "nomic-embed-text" }], DEFAULT_OLLAMA_MODEL)).toBe(false);
  });
});

describe("ensureLocalOllama", () => {
  it("skips spawn when tags already succeed and the model is present", async () => {
    const spawn = () => {
      throw new Error("should not spawn");
    };
    const status = await ensureLocalOllama(
      {
        url: DEFAULT_OLLAMA_URL,
        model: DEFAULT_OLLAMA_MODEL,
        dimensions: 4096,
      },
      {
        fetch: async (input) => {
          const url = String(input);
          if (url.endsWith("/api/tags")) {
            return Response.json({ models: [{ name: DEFAULT_OLLAMA_MODEL }] });
          }
          return Response.json({ embeddings: [Array.from({ length: 4096 }, () => 0.1)] });
        },
        spawn,
      },
    );
    expect(status).toBe("already-running");
  });

  it("spawns ollama serve then pulls a missing model", async () => {
    const spawned: Array<{ command: string; args: ReadonlyArray<string> }> = [];
    let healthy = false;
    let models: unknown[] = [];
    const status = await ensureLocalOllama(
      {
        url: DEFAULT_OLLAMA_URL,
        model: DEFAULT_OLLAMA_MODEL,
        dimensions: 4096,
      },
      {
        fetch: async (input) => {
          const url = String(input);
          if (url.endsWith("/api/tags")) {
            if (!healthy) {
              return new Response(null, { status: 503 });
            }
            return Response.json({ models });
          }
          return Response.json({ embeddings: [[0.1]] });
        },
        spawn: (command, args) => {
          spawned.push({ command, args });
          healthy = true;
          if (args[0] === "pull") {
            models = [{ name: DEFAULT_OLLAMA_MODEL }];
          }
          return { unref() {} };
        },
        sleep: async () => undefined,
        now: (() => {
          let tick = 0;
          return () => {
            tick += 1;
            return tick;
          };
        })(),
        commandPath: "C:\\Users\\Quinten\\AppData\\Local\\Programs\\Ollama\\ollama.exe",
      },
    );
    expect(status).toBe("started");
    expect(spawned.map((entry) => entry.args[0])).toEqual(["serve", "pull"]);
    expect(spawned[1]?.args).toEqual(["pull", DEFAULT_OLLAMA_MODEL]);
  });

  it("does not spawn for a remote URL", async () => {
    const status = await ensureLocalOllama(
      {
        url: "https://ollama.example.com",
        model: DEFAULT_OLLAMA_MODEL,
        dimensions: 4096,
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
