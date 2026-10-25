import { useEffect, useState } from "react";
import type { Lang, SearchResponse } from "../types";

export interface SearchState {
  readonly status: "idle" | "loading" | "ready" | "error";
  readonly response: SearchResponse | null;
  readonly error: Error | null;
}

const IDLE: SearchState = { status: "idle", response: null, error: null };

export async function fetchSearch(
  query: string,
  lang: Lang,
  signal: AbortSignal,
  limit = 20,
): Promise<SearchResponse> {
  const params = new URLSearchParams({
    q: query,
    lang,
    limit: String(limit),
  });
  const response = await fetch(`/db/search?${params.toString()}`, { signal });
  if (!response.ok) {
    throw new Error(`search -> ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as SearchResponse;
}

export function useFullTextSearch(
  query: string,
  lang: Lang,
  enabled = true,
  limit = 20,
): SearchState {
  const [state, setState] = useState<SearchState>(IDLE);

  useEffect(() => {
    const trimmed = query.trim();
    if (!enabled || trimmed.length === 0) {
      setState(IDLE);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setState((previous) => ({ ...previous, status: "loading" }));
      fetchSearch(trimmed, lang, controller.signal, limit)
        .then((response) => {
          if (!controller.signal.aborted) {
            setState({ status: "ready", response, error: null });
          }
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) {
            setState({
              status: "error",
              response: null,
              error: error instanceof Error ? error : new Error(String(error)),
            });
          }
        });
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, lang, enabled, limit]);

  return state;
}

