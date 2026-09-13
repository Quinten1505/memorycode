import type * as Effect from "effect/Effect";

import type { MemoryToolError } from "./errors.ts";

export interface RememberInput {
  readonly type: string;
  readonly slug: string;
  readonly title: string;
  readonly body?: string;
  readonly scope: ReadonlyArray<string>;
  readonly tags?: ReadonlyArray<string>;
  readonly extra?: Readonly<Record<string, unknown>>;
  readonly links?: ReadonlyArray<{
    verb: string;
    to: string;
    meta?: Readonly<Record<string, unknown>>;
  }>;
  readonly confirm?: boolean;
  readonly authoredBy?: string;
}

export interface MemoryCard {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly body: string;
  readonly status: string;
  readonly confidence: number;
  readonly scope: ReadonlyArray<string>;
  readonly tags: ReadonlyArray<string>;
  readonly edges: ReadonlyArray<{
    verb: string;
    to: string;
    meta?: Readonly<Record<string, unknown>>;
  }>;
  readonly evidence: ReadonlyArray<{ to: string; quote: string | null }>;
}

export interface RecallInput {
  readonly query: string;
  readonly project?: string;
  readonly types?: ReadonlyArray<string>;
  readonly k?: number;
  readonly include_proposed?: boolean;
}

export interface BootstrapInput {
  readonly project: string;
  readonly max_tokens?: number;
  readonly include_inbox?: boolean;
}

export interface IngestMessage {
  readonly role: "user" | "assistant" | "system";
  readonly text: string;
  readonly turnId: string | null;
}

export interface IngestTurnInput {
  readonly threadId: string;
  readonly turnId: string;
  readonly projectSlug: string;
  readonly provider: string;
  readonly messages: ReadonlyArray<IngestMessage>;
}

export interface IngestTurnResult {
  readonly runId: string;
  readonly observationIds: ReadonlyArray<string>;
  readonly promotedIds: ReadonlyArray<string>;
}

export interface BootstrapResult {
  readonly project?: MemoryCard;
  readonly constraints: ReadonlyArray<MemoryCard>;
  readonly conventions: ReadonlyArray<MemoryCard>;
  readonly preferences: ReadonlyArray<MemoryCard>;
  readonly open_incidents: ReadonlyArray<MemoryCard>;
  readonly recent_lessons: ReadonlyArray<MemoryCard>;
  readonly inbox?: ReadonlyArray<MemoryCard>;
  readonly tokens_est: number;
}

export interface MemoryStore {
  readonly remember: (input: RememberInput) => Effect.Effect<{ card: MemoryCard }, MemoryToolError>;
  readonly get: (input: { id: string }) => Effect.Effect<{ card: MemoryCard }, MemoryToolError>;
  readonly status: (input: {
    id: string;
    status: string;
    successor?: string;
    reason?: string;
    confirm?: boolean;
  }) => Effect.Effect<{ card: MemoryCard }, MemoryToolError>;
  readonly link: (input: {
    from: string;
    verb: string;
    to: string;
    meta?: Readonly<Record<string, unknown>>;
  }) => Effect.Effect<{ ok: true }, MemoryToolError>;
  readonly reclassify: (input: {
    from: string;
    to_type: string;
    to_slug: string;
    title?: string;
    body?: string;
    extra?: Readonly<Record<string, unknown>>;
    links?: RememberInput["links"];
    confirm?: boolean;
  }) => Effect.Effect<{ card: MemoryCard }, MemoryToolError>;
  readonly recall: (
    input: RecallInput,
  ) => Effect.Effect<{ cards: MemoryCard[]; tokens_est: number }, MemoryToolError>;
  readonly bootstrap: (input: BootstrapInput) => Effect.Effect<BootstrapResult, MemoryToolError>;
  readonly ingestTurn: (input: IngestTurnInput) => Effect.Effect<IngestTurnResult, MemoryToolError>;
}
