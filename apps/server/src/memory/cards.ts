import type { MemoryCard } from "./MemoryStore.ts";

export type StoredMemoryRecord = {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly body: string;
  readonly status: string;
  readonly confidence: number;
  readonly scope: ReadonlyArray<string>;
  readonly tags: ReadonlyArray<string>;
  readonly extra: Readonly<Record<string, unknown>>;
  readonly authoredBy: string;
};

export type StoredMemoryEdge = {
  readonly from: string;
  readonly verb: string;
  readonly to: string;
  readonly meta?: Readonly<Record<string, unknown>>;
};

export const estimateTokens = (card: MemoryCard): number =>
  Math.ceil(JSON.stringify(card).length / 4);

export const toMemoryCard = (
  record: StoredMemoryRecord,
  edges: ReadonlyArray<StoredMemoryEdge>,
): MemoryCard => {
  const cardEdges: Array<MemoryCard["edges"][number]> = [];
  const evidence: Array<MemoryCard["evidence"][number]> = [];

  for (const edge of edges) {
    if (edge.from === record.id) {
      cardEdges.push(
        edge.meta === undefined
          ? { verb: edge.verb, to: edge.to }
          : { verb: edge.verb, to: edge.to, meta: edge.meta },
      );
      if (edge.verb === "evidenced_by") {
        const quote = edge.meta?.quote;
        evidence.push({
          to: edge.to,
          quote: typeof quote === "string" ? quote : null,
        });
      }
      continue;
    }
    if (edge.to === record.id) {
      cardEdges.push({
        verb: edge.verb,
        to: edge.from,
        meta: { ...edge.meta, direction: "in" },
      });
    }
  }

  return {
    id: record.id,
    type: record.type,
    title: record.title,
    body: record.body,
    status: record.status,
    confidence: record.confidence,
    scope: record.scope,
    tags: record.tags,
    edges: cardEdges,
    evidence,
  };
};
