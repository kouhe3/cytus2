import { DISPLAY_LANG } from "./database";
import type { TextRecord } from "../types";

const cache = new Map<string, Promise<TextRecord | null>>();

export function loadTextRecord(ref: string): Promise<TextRecord | null> {
  const cached = cache.get(ref);
  if (cached) {
    return cached;
  }
  const request = fetch(
    `/db/text?ref=${encodeURIComponent(ref)}&lang=${DISPLAY_LANG}`,
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
      cache.delete(ref);
      throw error;
    });
  cache.set(ref, request);
  return request;
}
