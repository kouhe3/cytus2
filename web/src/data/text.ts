import type { Lang, TextRecord } from "../types";

const cache = new Map<string, Promise<TextRecord | null>>();

export interface TextLoad {
  readonly record: TextRecord | null;
  /** True when the server had no record for any language. */
  readonly missing: boolean;
}

export function loadTextRecord(ref: string, lang: Lang): Promise<TextRecord | null> {
  const key = `${lang}\u0000${ref}`;
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }
  const request = fetch(
    `/db/text?ref=${encodeURIComponent(ref)}&lang=${encodeURIComponent(lang)}`,
  )
    .then(async (response) => {
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new Error(`text ${ref} -> ${response.status}`);
      }
      return (await response.json()) as TextRecord;
    })
    .catch((error: unknown) => {
      cache.delete(key);
      throw error;
    });
  cache.set(key, request);
  return request;
}
