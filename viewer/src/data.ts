import { useEffect, useState } from "react";
import type {
  ExtraContent,
  ImContent,
  IndexData,
  Lang,
  OsContent,
} from "./types";

const BASE = import.meta.env.BASE_URL + "data/";

const cache = new Map<string, Promise<unknown>>();

function loadJson<T>(name: string): Promise<T> {
  const key = BASE + name;
  const hit = cache.get(key);
  if (hit) return hit as Promise<T>;
  const p = fetch(key).then((res) => {
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${name}`);
    return res.json() as Promise<T>;
  });
  cache.set(key, p);
  // allow a retry after a failure
  p.catch(() => cache.delete(key));
  return p;
}

export function loadIndex(): Promise<IndexData> {
  return loadJson<IndexData>("index.json");
}

export function loadIm(lang: Lang): Promise<ImContent> {
  return loadJson<ImContent>(`content.${lang}.im.json`);
}

export function loadOs(lang: Lang): Promise<OsContent> {
  return loadJson<OsContent>(`content.${lang}.os.json`);
}

export function loadExtra(lang: Lang): Promise<ExtraContent> {
  return loadJson<ExtraContent>(`content.${lang}.extra.json`);
}

/** 字幕正文索引：{ 字幕 key: { lang: [start, end, text][] } } */
export type SubsIndex = Record<string, Record<string, [number, number, string][]>>;

export function loadSongs(): Promise<import("./types").SongCatalog> {
  return loadJson<import("./types").SongCatalog>("songs.json");
}

export function loadSubsIndex(): Promise<SubsIndex> {
  return loadJson<SubsIndex>("subs-index.json");
}

/** OA 场景阶段：`<角色>_s001` 这类前缀 → 触发它的剧情 action（dump.cs 的 CHANGED_OA_BG_MOVIE_PREFIX） */
export type SceneStages = Record<
  string,
  {
    action?: string;
    pack?: string;
    level?: string;
    os?: string;
    topic?: string;
    boss?: string;
    movie?: string;
    /** 切换条件（ObjectAnalysisRecord.GetIdByStory 反编译） */
    when?: string;
  }
>;

export function loadSceneStages(): Promise<SceneStages> {
  return loadJson<SceneStages>("scenes.json");
}

/** 结场演出：视频 ← 游戏内配乐（dump.cs 里 IEndPlayEvent 的 SONG_ID / VIDEO_ID 常量） */
export type EndplayEvent = {
  class: string;
  song: string;
  video: string | null;
  line: number;
  /** 触发条件（反汇编验证，见 export_endplay_map.py 的 CONDITIONS） */
  condition?: string | null;
  /** 结场结束后按 isSelectedChoice 的去向 */
  after?: string | null;
  /** 前置过场（回应 PAFF 与否那次的分支影片） */
  prereq?: string | null;
};

export type EndplayMap = Record<string, EndplayEvent[]>;

export function loadEndplayMap(): Promise<EndplayMap> {
  return loadJson<EndplayMap>("endplay.json");
}

export type Async<T> =
  | { state: "loading" }
  | { state: "error"; error: Error }
  | { state: "ready"; data: T };

export function useAsync<T>(factory: () => Promise<T>, deps: unknown[]): Async<T> {
  const [result, setResult] = useState<Async<T>>({ state: "loading" });
  useEffect(() => {
    let alive = true;
    setResult({ state: "loading" });
    factory()
      .then((data) => alive && setResult({ state: "ready", data }))
      .catch((error: Error) => alive && setResult({ state: "error", error }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return result;
}

export interface Route {
  view: string;
  id: string;
}

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, "");
  const [view = "", ...rest] = raw.split("/");
  return { view: view || "timeline", id: decodeURIComponent(rest.join("/")) };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onHash = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return route;
}

export function navigate(view: string, id?: string) {
  const target = `#/${view}${id ? "/" + encodeURIComponent(id) : ""}`;
  if (window.location.hash === target) return;
  window.location.hash = target;
}

const LANG_KEY = "cytus2.lang";

export type Theme = "dark" | "light";

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("cytus2.theme");
    return saved === "light" ? "light" : "dark";
  });
  useEffect(() => {
    localStorage.setItem("cytus2.theme", theme);
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [theme]);
  return [theme, () => setTheme((t) => (t === "dark" ? "light" : "dark"))];
}

export function useLang(): [Lang, (lang: Lang) => void] {
  const [lang, setLang] = useState<Lang>(() => {
    const saved = localStorage.getItem(LANG_KEY) as Lang | null;
    return saved ?? "zh-Hans";
  });
  useEffect(() => {
    localStorage.setItem(LANG_KEY, lang);
    document.documentElement.lang = lang === "zh-Hans" ? "zh-CN" : lang === "zh-Hant" ? "zh-TW" : lang;
  }, [lang]);
  return [lang, setLang];
}

/** "693_03_16 14:18" -> "693 年 03 月 16 日 14:18" */
/** 角色编号 -> 游戏内显示名（gallerydata/folder），paff003 -> PΛFF */
export function characterName(index: { characters: Record<string, string> }, id: string): string {
  return index.characters?.[id] ?? id;
}

/** 秒 -> `m:ss.s`，字幕时间轴用 */
export function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const rest = seconds - m * 60;
  return `${m}:${rest.toFixed(1).padStart(4, "0")}`;
}

/** 触发 id 的归属：iM 帖 / OS 档案 / gallery 条目（游戏的 TRIGGER_TOPIC_ID 有时指向 OS 文件，如 hos027） */
export function sourceOf(
  index: { im?: { id: string }[]; os?: { id: string }[]; gallery?: { items: { location: string }[] } },
  id: string,
): "im" | "os" | "gallery" | "" {
  if (!id) return "";
  if (index.im?.some((t) => t.id === id)) return "im";
  if (index.os?.some((e) => e.id === id)) return "os";
  if (index.gallery?.items.some((g) => g.location === id)) return "gallery";
  return "";
}

/** 角色分级标签（免费 / 付费 / 支线 / 剧情） */
export function tierLabel(index: { characterTiers?: Record<string, string> }, id: string): string {
  const tier = index.characterTiers?.[id];
  return ({ free: "免费", paid: "付费", side: "支线", plot: "剧情" } as Record<string, string>)[
    tier ?? ""
  ] ?? "";
}

export function formatDate(date: string): string {
  const [day, time] = date.split(" ");
  const parts = day ? day.split("_") : [];
  if (parts.length < 3) return date || "—";
  const [y, m, d] = parts;
  return time ? `${y} 年 ${m} 月 ${d} 日 ${time}` : `${y} 年 ${m} 月 ${d} 日`;
}
