import { useEffect, useState } from "react";
import { loadMediaManifest, type MediaManifest } from "./media";

/**
 * The manifest is fetched once per page (see `loadMediaManifest`), but every
 * consumer still needs the three explicit states: a failed manifest is a note
 * in the player, not a blank rectangle, and `loading` must not be mistaken for
 * "this clip was never exported".
 */
export interface MediaManifestState {
  readonly status: "loading" | "ready" | "error";
  /** `null` while loading and after a failure. */
  readonly manifest: MediaManifest | null;
}

const LOADING: MediaManifestState = { status: "loading", manifest: null };
const FAILED: MediaManifestState = { status: "error", manifest: null };

export function useMediaManifest(): MediaManifestState {
  const [state, setState] = useState<MediaManifestState>(LOADING);
  useEffect(() => {
    let active = true;
    loadMediaManifest()
      .then((manifest) => {
        if (active) {
          setState({ status: "ready", manifest });
        }
      })
      .catch(() => {
        if (active) {
          setState(FAILED);
        }
      });
    return () => {
      active = false;
    };
  }, []);
  return state;
}
