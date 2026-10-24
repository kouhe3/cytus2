import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Lang, LocalizedText } from "../types";

export const DEFAULT_LANG: Lang = "zh-Hans";

/**
 * Order used when the selected language has no text. It mirrors the order in
 * `web/plugins/canonical-data.ts` so the client and the text store agree on
 * which language was served.
 */
export const LANG_FALLBACK: Lang[] = [
  "zh-Hans",
  "en",
  "zh-Hant",
  "ja",
  "ko",
];

const STORAGE_KEY = "cytus2.language";

export interface LocalizedPick {
  readonly value: string;
  /** Language the value actually came from, or null when no language has text. */
  readonly lang: Lang | null;
  readonly requested: Lang;
  readonly fallback: boolean;
}

export function isLang(value: unknown): value is Lang {
  return (
    value === "en" ||
    value === "ja" ||
    value === "zh-Hant" ||
    value === "ko" ||
    value === "zh-Hans"
  );
}

export function pickLocalized(
  map: LocalizedText | null | undefined,
  requested: Lang,
): LocalizedPick {
  if (map) {
    const exact = map[requested];
    if (exact && exact.trim()) {
      return { value: exact, lang: requested, requested, fallback: false };
    }
    for (const code of LANG_FALLBACK) {
      if (code === requested) {
        continue;
      }
      const value = map[code];
      if (value && value.trim()) {
        return { value, lang: code, requested, fallback: true };
      }
    }
  }
  return { value: "", lang: null, requested, fallback: false };
}

export function localizedValue(
  map: LocalizedText | null | undefined,
  requested: Lang,
): string {
  return pickLocalized(map, requested).value;
}

interface LanguageContextValue {
  readonly lang: Lang;
  readonly setLang: (lang: Lang) => void;
}

const LanguageContext = createContext<LanguageContextValue>({
  lang: DEFAULT_LANG,
  setLang: () => undefined,
});

function readStoredLanguage(): Lang {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isLang(stored) ? stored : DEFAULT_LANG;
  } catch {
    return DEFAULT_LANG;
  }
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(readStoredLanguage);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // A blocked storage API only costs persistence, not the switch itself.
    }
    document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo<LanguageContextValue>(
    () => ({ lang, setLang }),
    [lang],
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}
