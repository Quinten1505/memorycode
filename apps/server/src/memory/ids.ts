import { MemoryToolError } from "./errors.ts";

const SLUG_PATTERN = /^[a-z0-9-]{1,80}$/;

export function assertSlug(slug: string): void {
  if (!SLUG_PATTERN.test(slug)) {
    throw new MemoryToolError({
      error: "invalid_slug",
      hint: "slug must match ^[a-z0-9-]{1,80}$",
    });
  }
}

export function composeRecordId(type: string, slug: string): string {
  assertSlug(slug);
  return `${type}:${slug}`;
}

export function parseRecordId(id: string): { type: string; slug: string } {
  const colon = id.indexOf(":");
  if (colon <= 0 || colon === id.length - 1) {
    throw new MemoryToolError({
      error: "invalid_slug",
      hint: "record id must be type:slug",
    });
  }
  const type = id.slice(0, colon);
  const slug = id.slice(colon + 1).replaceAll(/[⟨⟩`]/g, "");
  assertSlug(slug);
  return { type, slug };
}
