import * as Effect from "effect/Effect";

import type { StoredMemoryEdge, StoredMemoryRecord } from "./cards.ts";
import type { BootstrapInput, MemoryStore, RecallInput, RememberInput } from "./MemoryStore.ts";
import {
  applyStatus,
  assertReclassifyTarget,
  bootstrapFromStore,
  buildRemember,
  cardOf,
  checkLinkTypes,
  fail,
  parseId,
  planReclassifySource,
  recallFromStore,
  shouldAddEdge,
  validateRememberInput,
  withEdgeDefaults,
} from "./storeLogic.ts";

export const makeInMemoryMemoryStore = (): MemoryStore => {
  const records = new Map<string, StoredMemoryRecord>();
  const edges: StoredMemoryEdge[] = [];

  const applyEdge = (edge: StoredMemoryEdge) => {
    const next = withEdgeDefaults(edge);
    if (!shouldAddEdge(edges, next)) {
      return;
    }
    edges.push(next);
  };

  const remember = Effect.fn("InMemoryMemoryStore.remember")(function* (input: RememberInput) {
    const id = yield* validateRememberInput(input);
    const { record, links } = yield* buildRemember(input, id, records.get(id));
    records.set(id, record);
    for (const link of links) {
      applyEdge(link);
    }
    return { card: cardOf(record, edges) };
  });

  const get = Effect.fn("InMemoryMemoryStore.get")(function* (input: { id: string }) {
    yield* parseId(input.id);
    const record = records.get(input.id);
    if (record === undefined) {
      return yield* fail("not_found");
    }
    return { card: cardOf(record, edges) };
  });

  const link = Effect.fn("InMemoryMemoryStore.link")(function* (input: {
    from: string;
    verb: string;
    to: string;
    meta?: Readonly<Record<string, unknown>>;
  }) {
    yield* checkLinkTypes(input);
    if (!records.has(input.from) || !records.has(input.to)) {
      return yield* fail("not_found");
    }
    applyEdge({
      from: input.from,
      verb: input.verb,
      to: input.to,
      ...(input.meta === undefined ? {} : { meta: input.meta }),
    });
    return { ok: true } as const;
  });

  const status = Effect.fn("InMemoryMemoryStore.status")(function* (input: {
    id: string;
    status: string;
    successor?: string;
    reason?: string;
    confirm?: boolean;
  }) {
    const planned = yield* applyStatus(
      input,
      records.get(input.id),
      input.successor !== undefined && records.has(input.successor),
    );
    if (planned.successorEdge !== undefined) {
      applyEdge(planned.successorEdge);
    }
    records.set(input.id, planned.record);
    return { card: cardOf(planned.record, edges) };
  });

  const reclassify = Effect.fn("InMemoryMemoryStore.reclassify")(function* (input: {
    from: string;
    to_type: string;
    to_slug: string;
    title?: string;
    body?: string;
    extra?: Readonly<Record<string, unknown>>;
    links?: RememberInput["links"];
    confirm?: boolean;
  }) {
    const thought = yield* planReclassifySource(input.from, records.get(input.from));
    yield* assertReclassifyTarget(input.to_type);
    const created = yield* remember({
      type: input.to_type,
      slug: input.to_slug,
      title: input.title ?? thought.title,
      body: input.body ?? thought.body,
      scope: thought.scope,
      tags: thought.tags,
      extra: input.extra,
      links: input.links,
      confirm: input.confirm,
    });
    yield* link({ from: input.from, verb: "promoted_to", to: created.card.id });
    yield* status({ id: input.from, status: "promoted" });
    return created;
  });

  const recall = (input: RecallInput) =>
    Effect.succeed(recallFromStore(records.values(), edges, input)).pipe(
      Effect.withSpan("InMemoryMemoryStore.recall"),
    );

  const bootstrap = (input: BootstrapInput) =>
    Effect.succeed(bootstrapFromStore(records.values(), input)).pipe(
      Effect.withSpan("InMemoryMemoryStore.bootstrap"),
    );

  return {
    remember,
    get,
    status,
    link,
    reclassify,
    recall,
    bootstrap,
  };
};
