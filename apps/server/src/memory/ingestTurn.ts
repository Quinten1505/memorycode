import * as Effect from "effect/Effect";

import type { MemoryToolError } from "./errors.ts";
import type {
  IngestTurnInput,
  IngestTurnResult,
  MemoryStore,
  RememberInput,
} from "./MemoryStore.ts";

export const INGEST_TRANSCRIPT_TAIL = 12_000;
export const MAX_OBSERVATIONS = 12;
export const MAX_PROMOTIONS = 8;
export const MIN_OBSERVATION_CHARS = 40;

export const PROMOTE_TYPES = [
  "decision",
  "constraint",
  "convention",
  "lesson",
  "incident",
  "preference",
  "fact",
] as const;
export type PromoteType = (typeof PROMOTE_TYPES)[number];

const PROMOTE_TYPE_SET = new Set<string>(PROMOTE_TYPES);

export interface IngestMessage {
  readonly role: "user" | "assistant" | "system";
  readonly text: string;
  readonly turnId: string | null;
}

export interface ObservationDraft {
  readonly slug: string;
  readonly title: string;
  readonly body: string;
  readonly kind: "note" | "quote" | "hypothesis";
}

export interface PromotionDraft {
  readonly type: PromoteType;
  readonly slug: string;
  readonly title: string;
  readonly body: string;
  readonly extra?: RememberInput["extra"];
}

export function kebabSlug(text: string, max = 80): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max);
}

export function runSlugForTurn(turnId: string): string {
  const slug = kebabSlug(`t-${turnId}`);
  return slug.length > 0 ? slug : "t-unknown";
}

export function clipTranscript(text: string, tail = INGEST_TRANSCRIPT_TAIL): string {
  if (text.length <= tail) {
    return text;
  }
  return text.slice(text.length - tail);
}

const firstLine = (text: string): string => {
  const line = text.split(/\r?\n/).find((entry) => entry.trim().length > 0) ?? text;
  return line.trim().slice(0, 200);
};

export function extractObservations(
  messages: ReadonlyArray<IngestMessage>,
  turnId: string,
): ReadonlyArray<ObservationDraft> {
  const turnMessages = messages.filter(
    (message) => message.turnId === turnId && message.role !== "system",
  );
  const drafts: ObservationDraft[] = [];
  let index = 0;
  for (const message of turnMessages) {
    const body = message.text.trim();
    if (body.length < MIN_OBSERVATION_CHARS) {
      continue;
    }
    index += 1;
    const slug = kebabSlug(`obs-${turnId.slice(0, 8)}-${index}`);
    if (slug.length === 0) {
      continue;
    }
    drafts.push({
      slug,
      title: firstLine(body),
      body: clipTranscript(body, 4_000),
      kind: message.role === "user" ? "quote" : "note",
    });
    if (drafts.length >= MAX_OBSERVATIONS) {
      break;
    }
  }
  return drafts;
}

const LABEL_PATTERN =
  /^(?:#{1,3}\s*)?(decision|constraint|convention|lesson|incident|preference|fact)\s*[:\-—]\s*(.+)$/gim;

const extraFor = (type: PromoteType): RememberInput["extra"] | undefined => {
  if (type === "constraint") {
    return { severity: "medium" };
  }
  if (type === "lesson") {
    return { kind: "gotcha" };
  }
  return undefined;
};

export function extractPromotions(transcript: string): ReadonlyArray<PromotionDraft> {
  const drafts: PromotionDraft[] = [];
  const seen = new Set<string>();
  const text = clipTranscript(transcript);
  for (const match of text.matchAll(LABEL_PATTERN)) {
    const type = match[1]?.toLowerCase();
    const rest = match[2]?.trim() ?? "";
    if (type === undefined || !PROMOTE_TYPE_SET.has(type) || rest.length === 0) {
      continue;
    }
    const title = firstLine(rest);
    const slug = kebabSlug(title);
    if (slug.length === 0 || seen.has(`${type}:${slug}`)) {
      continue;
    }
    seen.add(`${type}:${slug}`);
    const extra = extraFor(type as PromoteType);
    drafts.push({
      type: type as PromoteType,
      slug,
      title,
      body: rest.slice(0, 4_000),
      ...(extra === undefined ? {} : { extra }),
    });
    if (drafts.length >= MAX_PROMOTIONS) {
      break;
    }
  }
  return drafts;
}

export function titlesMatch(existing: string, incoming: string): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const left = normalize(existing);
  const right = normalize(incoming);
  return left.length > 0 && (left === right || left.includes(right) || right.includes(left));
}

export const runIngestTurn = (
  store: Pick<MemoryStore, "remember" | "recall">,
  writeObservation: (
    draft: ObservationDraft,
    input: IngestTurnInput,
    runId: string,
  ) => Effect.Effect<string, MemoryToolError>,
  input: IngestTurnInput,
): Effect.Effect<IngestTurnResult, MemoryToolError> =>
  Effect.gen(function* () {
    const runId = `run:${runSlugForTurn(input.turnId)}`;
    const scope = [`project:${input.projectSlug}`];
    const observations = extractObservations(input.messages, input.turnId);
    const observationIds: string[] = [];
    for (const draft of observations) {
      observationIds.push(yield* writeObservation(draft, input, runId));
    }
    const transcript = clipTranscript(
      input.messages
        .filter((message) => message.turnId === input.turnId)
        .map((message) => message.text)
        .join("\n"),
    );
    const promotedIds: string[] = [];
    for (const draft of extractPromotions(transcript)) {
      const existing = yield* store.recall({
        query: draft.title,
        project: input.projectSlug,
        types: [draft.type],
        k: 5,
        include_proposed: true,
      });
      if (existing.cards.some((card) => titlesMatch(card.title, draft.title))) {
        continue;
      }
      const created = yield* store.remember({
        type: draft.type,
        slug: draft.slug,
        title: draft.title,
        body: draft.body,
        scope,
        authoredBy: "agent:promoter",
        ...(draft.extra === undefined ? {} : { extra: draft.extra }),
      });
      promotedIds.push(created.card.id);
    }
    return { runId, observationIds, promotedIds };
  });
