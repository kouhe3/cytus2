import { useEffect, useState } from "react";
import { loadTextRecords } from "./text";
import type { Lang, TextRecord } from "../types";

const EMPTY = new Map<string, TextRecord | null>();

export type TextRecordsState =
  | { readonly status: "idle"; readonly records: ReadonlyMap<string, TextRecord | null> }
  | { readonly status: "loading"; readonly records: ReadonlyMap<string, TextRecord | null> }
  | { readonly status: "ready"; readonly records: ReadonlyMap<string, TextRecord | null> }
  | {
      readonly status: "error";
      readonly records: ReadonlyMap<string, TextRecord | null>;
      readonly error: Error;
    };

const IDLE: TextRecordsState = { status: "idle", records: EMPTY };
const LOADING: TextRecordsState = { status: "loading", records: EMPTY };

/**
 * Batch-load the bodies behind a list of refs. `refs` is keyed by its joined
 * value so a freshly built array does not retrigger the request; changing the
 * sidebar language refetches because the server resolves the fallback per
 * language.
 */
export function useTextRecords(
  refs: readonly string[],
  lang: Lang,
): TextRecordsState {
  const key = refs.join("\u0000");
  const [state, setState] = useState<TextRecordsState>(IDLE);

  useEffect(() => {
    if (!key) {
      setState(IDLE);
      return;
    }
    let active = true;
    setState(LOADING);
    loadTextRecords(key.split("\u0000"), lang)
      .then((records) => {
        if (active) {
          setState({ status: "ready", records });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setState({
            status: "error",
            records: EMPTY,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      });
    return () => {
      active = false;
    };
  }, [key, lang]);

  return state;
}
