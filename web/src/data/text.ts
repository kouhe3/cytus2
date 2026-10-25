import type { Lang, TextRecord } from "../types";

const cache = new Map<string, Promise<TextRecord | null>>();

function cacheKey(ref: string, lang: Lang): string {
  return `${lang}\u0000${ref}`;
}

export interface TextLoad {
  readonly record: TextRecord | null;
  /** True when the server had no record for any language. */
  readonly missing: boolean;
}

export function loadTextRecord(ref: string, lang: Lang): Promise<TextRecord | null> {
  const key = cacheKey(ref, lang);
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

interface TextBatchResponse {
  readonly lang: Lang;
  readonly records: Record<string, TextRecord | null>;
}

/**
 * Load several text records through one request. Records already cached (by
 * `loadTextRecord` or a previous batch) are reused, so a reply list and the
 * sidebar language switch do not fan out into one request per reply.
 */
export async function loadTextRecords(
  refs: readonly string[],
  lang: Lang,
): Promise<Map<string, TextRecord | null>> {
  const unique = [...new Set(refs)];
  const missing = unique.filter((ref) => !cache.has(cacheKey(ref, lang)));

  if (missing.length === 1) {
    await loadTextRecord(missing[0] as string, lang);
  } else if (missing.length > 1) {
    const query = missing
      .map((ref) => `ref=${encodeURIComponent(ref)}`)
      .join("&");
    const batch = fetch(`/db/text?${query}&lang=${encodeURIComponent(lang)}`).then(
      async (response) => {
        if (!response.ok) {
          throw new Error(`text batch -> ${response.status}`);
        }
        return (await response.json()) as TextBatchResponse;
      },
    );
    for (const ref of missing) {
      cache.set(
        cacheKey(ref, lang),
        batch.then((payload) => payload.records[ref] ?? null),
      );
    }
    try {
      await batch;
    } catch (error) {
      for (const ref of missing) {
        cache.delete(cacheKey(ref, lang));
      }
      throw error;
    }
  }

  const entries = await Promise.all(
    unique.map(async (ref) => {
      const record = await (cache.get(cacheKey(ref, lang)) ??
        Promise.resolve(null));
      return [ref, record] as const;
    }),
  );
  return new Map(entries);
}
