export type MemoryEmbedder = {
  readonly embed: (text: string) => Promise<ReadonlyArray<number> | undefined>;
};

export interface OllamaEmbedInput {
  readonly url: string;
  readonly model: string;
  readonly dimensions: number;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;

const asNumberArray = (value: unknown): number[] | undefined => {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }
  const numbers = value.filter((entry): entry is number => typeof entry === "number");
  return numbers.length === value.length ? numbers : undefined;
};

export function embeddingFromOllamaBody(
  body: unknown,
  dimensions: number,
): ReadonlyArray<number> | undefined {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return undefined;
  }
  const record = body as { embeddings?: unknown; embedding?: unknown };
  const first = Array.isArray(record.embeddings) ? record.embeddings[0] : undefined;
  const vector = asNumberArray(first) ?? asNumberArray(record.embedding);
  if (vector === undefined || vector.length !== dimensions) {
    return undefined;
  }
  return vector;
}

export function makeOllamaEmbedder(input: OllamaEmbedInput): MemoryEmbedder {
  const fetchImpl = input.fetch ?? fetch;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const embedUrl = new URL("/api/embed", input.url).toString();
  return {
    embed: async (text: string) => {
      const trimmed = text.trim();
      if (trimmed.length === 0) {
        return undefined;
      }
      try {
        const response = await fetchImpl(embedUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: input.model,
            input: trimmed,
            dimensions: input.dimensions,
            keep_alive: -1,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) {
          return undefined;
        }
        return embeddingFromOllamaBody(await response.json(), input.dimensions);
      } catch {
        return undefined;
      }
    },
  };
}
