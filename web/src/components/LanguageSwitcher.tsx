import { LANGUAGES, useLanguage } from "../data/language";

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { lang, setLang } = useLanguage();
  return (
    <div
      className={compact ? "lang-switch compact" : "lang-switch"}
      role="group"
      aria-label="Text language"
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
