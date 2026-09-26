import { describe, expect, it } from "@effect/vitest";

import { embeddingFromOllamaBody, makeOllamaEmbedder } from "./ollamaEmbed.ts";

const dim = 4;

describe("embeddingFromOllamaBody", () => {
  it("reads /api/embed embeddings and rejects the wrong width", () => {
    expect(embeddingFromOllamaBody({ embeddings: [[0.1, 0.2, 0.3, 0.4]] }, dim)).toEqual([
      0.1, 0.2, 0.3, 0.4,
    ]);
    expect(embeddingFromOllamaBody({ embedding: [0.1, 0.2, 0.3, 0.4] }, dim)).toEqual([
      0.1, 0.2, 0.3, 0.4,
    ]);
    expect(embeddingFromOllamaBody({ embeddings: [[0.1, 0.2]] }, dim)).toBeUndefined();
  });
});

describe("makeOllamaEmbedder", () => {
  it("posts /api/embed and returns a matching vector", async () => {
    const embedder = makeOllamaEmbedder({
      url: "http://127.0.0.1:11434",
      model: "qwen3-embedding:8b-q4_K_M",
      dimensions: dim,
      fetch: async (input, init) => {
        expect(String(input)).toBe("http://127.0.0.1:11434/api/embed");
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body)) as {
          model: string;
          input: string;
          dimensions: number;
          keep_alive: number;
        };
        expect(body.model).toBe("qwen3-embedding:8b-q4_K_M");
        expect(body.input).toBe("hello");
        expect(body.dimensions).toBe(dim);
        expect(body.keep_alive).toBe(-1);
        return Response.json({ embeddings: [[1, 2, 3, 4]] });
      },
    });
    expect(await embedder.embed(" hello ")).toEqual([1, 2, 3, 4]);
  });

  it("returns undefined when Ollama is down", async () => {
    const embedder = makeOllamaEmbedder({
      url: "http://127.0.0.1:11434",
      model: "qwen3-embedding:8b-q4_K_M",
      dimensions: dim,
      fetch: async () => {
        throw new Error("connection refused");
      },
    });
    expect(await embedder.embed("hello")).toBeUndefined();
  });
});
