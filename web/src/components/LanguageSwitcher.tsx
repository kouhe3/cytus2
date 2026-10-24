import { useLanguage } from "../data/language";
import { useI18n } from "../data/i18n";
import { LANGUAGES } from "../data/messages";

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { lang, setLang } = useLanguage();
  const i18n = useI18n();
  return (
    <div
      className={compact ? "lang-switch compact" : "lang-switch"}
      role="group"
      aria-label={i18n.t("language.groupAria")}
      data-testid="language-switcher"
    >
      {LANGUAGES.map((option) => (
        <button
          key={option.code}
          type="button"
          className={option.code === lang ? "lang-option active" : "lang-option"}
          aria-pressed={option.code === lang}
          title={option.title}
          data-testid={`lang-${option.code}`}
          onClick={() => setLang(option.code)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
