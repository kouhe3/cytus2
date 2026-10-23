import type { Lang } from "../types";
import { VIEWS } from "../rows";

const LANGS: { code: Lang; label: string }[] = [
  { code: "zh-Hans", label: "简" },
  { code: "zh-Hant", label: "繁" },
  { code: "en", label: "EN" },
  { code: "ja", label: "日" },
  { code: "ko", label: "한" },
];

export function Sidebar({
  view,
  counts,
  lang,
  onView,
  onLang,
}: {
  view: string;
  counts: Record<string, number>;
  lang: Lang;
  onView: (view: string) => void;
  onLang: (lang: Lang) => void;
}) {
  return (
    <aside className="rail">
      <div className="brand">
        <strong>Cytus II 剧情库</strong>
        <span>im · os · oa · backup</span>
      </div>
      <div className="nav-label">视图</div>
      <nav aria-label="视图切换" style={{ display: "contents" }}>
        {VIEWS.map((v) => (
          <button
            type="button"
            key={v.id}
            className="nav-item"
            aria-current={v.id === view ? "page" : undefined}
            onClick={() => onView(v.id)}
          >
            <b>{v.label}</b>
            <em>{v.countKey ? counts[v.countKey] ?? "" : ""}</em>
          </button>
        ))}
      </nav>
      <div className="nav-label">语言</div>
      <div className="lang" role="group" aria-label="语言">
        {LANGS.map((l) => (
          <button
            type="button"
            key={l.code}
            aria-pressed={l.code === lang}
            onClick={() => onLang(l.code)}
          >
            {l.label}
          </button>
        ))}
      </div>
    </aside>
  );
}
