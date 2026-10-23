import { useEffect, useState } from "react";
import { loadDatabase } from "./database";
import type { Database } from "../types";

export type DatabaseState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly error: Error }
  | { readonly status: "ready"; readonly db: Database };

export function useDatabase(): DatabaseState {
  const [state, setState] = useState<DatabaseState>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    loadDatabase(controller.signal)
      .then((db) => {
        if (!controller.signal.aborted) {
          setState({ status: "ready", db });
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setState({
            status: "error",
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      });
    return () => controller.abort();
  }, []);
  return state;
}
