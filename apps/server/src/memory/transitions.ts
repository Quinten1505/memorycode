export type TransitionOptions = {
  readonly confirm: boolean;
  readonly successor?: string;
};

export type TransitionFailure =
  | "ok"
  | "invalid_transition"
  | "successor_required"
  | "confirm_required";

type TransitionRule = {
  readonly to: string;
  readonly successor?: true;
  readonly confirm?: true;
};

/** Allowed status transitions (ontology §10.4 + D7 confirm). */
const TRANSITIONS: Readonly<Record<string, Readonly<Record<string, readonly TransitionRule[]>>>> = {
  decision: {
    proposed: [{ to: "accepted" }, { to: "rejected" }, { to: "superseded", successor: true }],
    accepted: [{ to: "superseded", successor: true }],
  },
  constraint: {
    proposed: [{ to: "active", confirm: true }, { to: "obsolete" }],
    active: [{ to: "relaxed" }, { to: "obsolete" }],
    relaxed: [{ to: "active" }, { to: "obsolete" }],
  },
  convention: {
    proposed: [{ to: "active" }, { to: "deprecated" }],
    active: [{ to: "deprecated" }],
  },
  preference: {
    proposed: [{ to: "active", confirm: true }, { to: "withdrawn" }],
    active: [{ to: "withdrawn" }],
  },
  lesson: {
    active: [{ to: "superseded", successor: true }],
  },
  skill: {
    draft: [{ to: "active" }, { to: "retired" }],
    active: [{ to: "retired" }],
  },
  fact: {
    asserted: [{ to: "contradicted" }, { to: "expired" }],
  },
  incident: {
    open: [{ to: "mitigated" }, { to: "closed" }],
    mitigated: [{ to: "closed" }],
  },
  episode: {
    open: [{ to: "closed" }],
  },
  thought: {
    inbox: [{ to: "clustered" }, { to: "promoted" }, { to: "discarded" }],
    clustered: [{ to: "promoted" }, { to: "discarded" }, { to: "inbox" }],
  },
  schema_proposal: {
    proposed: [{ to: "accepted" }, { to: "rejected" }],
    accepted: [{ to: "shipped" }],
  },
};

export function transitionFailure(
  type: string,
  from: string,
  to: string,
  opts: TransitionOptions,
): TransitionFailure {
  const fromRules = TRANSITIONS[type]?.[from];
  if (fromRules === undefined) {
    return "invalid_transition";
  }
  const rule = fromRules.find((candidate) => candidate.to === to);
  if (rule === undefined) {
    return "invalid_transition";
  }
  if (rule.successor === true && (opts.successor === undefined || opts.successor === "")) {
    return "successor_required";
  }
  if (rule.confirm === true && opts.confirm !== true) {
    return "confirm_required";
  }
  return "ok";
}

export function canTransition(
  type: string,
  from: string,
  to: string,
  opts: TransitionOptions,
): boolean {
  return transitionFailure(type, from, to, opts) === "ok";
}
