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
  readonly validFrom?: string;
};

export type StoredMemoryEdge = {
  readonly from: string;
  readonly verb: string;
  readonly to: string;
  readonly meta?: Readonly<Record<string, unknown>>;
};

export const DEFAULT_RECALL_TOKEN_CAP = 3000;
export const DEFAULT_BOOTSTRAP_TOKEN_CAP = 2000;

const SENSITIVITY_PREFIX = "sensitivity:";
const DEFAULT_SENSITIVITY = new Set(["normal", "work"]);

export const estimateTokens = (card: MemoryCard): number =>
  Math.ceil(JSON.stringify(card).length / 4);

export const estimateCardsTokens = (cards: ReadonlyArray<MemoryCard>): number =>
  cards.reduce((sum, card) => sum + estimateTokens(card), 0);

/** Keep cards in order while each added card still fits under `cap`. */
export const takeUntilTokenCap = (cards: ReadonlyArray<MemoryCard>, cap: number): MemoryCard[] => {
  const taken: MemoryCard[] = [];
  let tokens = 0;
  for (const card of cards) {
    const next = estimateTokens(card);
    if (tokens + next > cap) {
      continue;
    }
    taken.push(card);
    tokens += next;
  }
  return taken;
};

/** Case-insensitive substring hits over title+body; embeddings are ignored. */
export const ftsHitCount = (query: string, title: string, body: string): number => {
  const haystack = `${title} ${body}`.toLowerCase();
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0);
  let count = 0;
  for (const term of terms) {
    let from = 0;
    while (from < haystack.length) {
      const at = haystack.indexOf(term, from);
      if (at === -1) {
        break;
      }
      count += 1;
      from = at + term.length;
    }
  }
  return count;
};

/** Default allow normal/work and missing sensitivity; private only when noted. */
export const sensitivityPasses = (
  scope: ReadonlyArray<string>,
  options: { allowPrivate?: boolean } = {},
): boolean => {
  const values = scope
    .filter((token) => token.startsWith(SENSITIVITY_PREFIX))
    .map((token) => token.slice(SENSITIVITY_PREFIX.length));
  if (values.length === 0) {
    return true;
  }
  if (values.includes("private")) {
    return options.allowPrivate === true;
  }
  return values.some((value) => DEFAULT_SENSITIVITY.has(value));
};

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
