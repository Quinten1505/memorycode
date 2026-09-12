export type ScopeMatchOptions = {
  readonly project: string;
  readonly includeGlobal?: boolean;
};

/**
 * Retrieval scope match: project:<slug> OR (includeGlobal !== false && project:_global).
 */
export function scopeMatches(tokens: ReadonlyArray<string>, options: ScopeMatchOptions): boolean {
  const projectToken = `project:${options.project}`;
  if (tokens.includes(projectToken)) {
    return true;
  }
  if (options.includeGlobal === false) {
    return false;
  }
  return tokens.includes("project:_global");
}
