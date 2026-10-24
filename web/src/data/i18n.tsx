import { useMemo } from "react";
import { useLanguage } from "./language";
import { createI18n } from "./messages";
import type { I18n } from "./messages";

/**
 * UI strings for the active language. Shares `LanguageProvider` state with the
 * canonical text store, so the interface and the entity text never diverge.
 */
export function useI18n(): I18n {
  const { lang } = useLanguage();
  return useMemo(() => createI18n(lang), [lang]);
}

export type { I18n, MessageKey, Translate } from "./messages";
