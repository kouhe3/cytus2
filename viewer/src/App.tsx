import { useEffect, useMemo, useRef, useState } from "react";
import {
  loadExtra,
  loadIm,
  loadIndex,
  loadOs,
  loadSubsIndex,
  navigate,
  useAsync,
  useLang,
  useRoute,
  useTheme,
} from "./data";
import {
  EMPTY_FILTERS,
  TIMELINE_MODES,
  VIEWS,
  filterOptions,
  hasFilters,
  isOsId,
  rowsFor,
  sanitizeFilters,
  type ArchiveFilters,
  type Row,
  type TimelineMode,
} from "./rows";
import { searchRows } from "./search";
import { ListPane } from "./components/ListPane";
import { Sidebar } from "./components/Sidebar";
import { StateBlock } from "./components/ui";
import { Reader } from "./views/Reader";
import type { ExtraContent, ImContent, OsContent } from "./types";

const EMPTY_OS: OsContent = { lang: "zh-Hans", os: {} };
const EMPTY_EXTRA: ExtraContent = { lang: "zh-Hans", label: "", oa: {}, backup: {}, audio: [], assistants: [] };

export default function App() {
  const indexAsync = useAsync(loadIndex, []);
  const [lang, setLang] = useLang();
  const [theme, toggleTheme] = useTheme();
  const route = useRoute();
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<ArchiveFilters>(EMPTY_FILTERS);
  const [timelineMode, setTimelineMode] = useState<TimelineMode>("chapter");
  /** iM 账户过滤：空 = 全部，item.avatar = 某账户，other = 其他 */
  const [imFilter, setImFilter] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const readerRef = useRef<HTMLDivElement>(null);
  const q = query.trim();

  const index = indexAsync.state === "ready" ? indexAsync.data : undefined;
  const view = route.view;
  const needOs = view === "timeline" || q.length >= 2 || (index ? isOsId(index, route.id) : false);
  const needExtra =
    view === "oa" || view === "backup" || view === "branching" || view === "extras" || q.length >= 2;
  const needSubs = q.length >= 2;

  const imAsync = useAsync<ImContent>(() => loadIm(lang), [lang]);
  const osAsync = useAsync<OsContent>(() => (needOs ? loadOs(lang) : Promise.resolve(EMPTY_OS)), [lang, needOs]);
  const extraAsync = useAsync<ExtraContent>(
    () => (needExtra ? loadExtra(lang) : Promise.resolve(EMPTY_EXTRA)),
    [lang, needExtra],
  );
  const subsAsync = useAsync(() => (needSubs ? loadSubsIndex() : Promise.resolve({})), [needSubs]);

  useEffect(() => {
    readerRef.current?.scrollTo({ top: 0 });
    if (index) {
      const found = index.os.find((e) => e.id === route.id) ?? index.im.find((t) => t.id === route.id);
      document.title = found
        ? `${("names" in found ? found.names[lang] : found.titles[lang]) || route.id} · Cytus II 剧情库`
        : "Cytus II 剧情阅览";
    }
  }, [route.id, route.view, index, lang]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement !== searchRef.current) {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape" && document.activeElement === searchRef.current) {
        setQuery("");
        searchRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const im = imAsync.state === "ready" ? imAsync.data : undefined;
  const os = osAsync.state === "ready" ? osAsync.data : EMPTY_OS;
  const extra = extraAsync.state === "ready" ? extraAsync.data : undefined;
  const subs = subsAsync.state === "ready" ? subsAsync.data : null;

  const options = useMemo(
    () => (index ? filterOptions(index, filters) : { chapters: [], versions: [], folders: [], characters: [] }),
    [index, filters],
  );
  const activeFilters = useMemo(() => sanitizeFilters(filters, options), [filters, options]);

  useEffect(() => {
    if (
      activeFilters.chapter !== filters.chapter ||
      activeFilters.version !== filters.version ||
      activeFilters.folder !== filters.folder
    ) {
      setFilters(activeFilters);
    }
  }, [activeFilters, filters]);

  const rows = useMemo<Row[]>(() => {
    if (!index) return [];
    if (q.length >= 2) return searchRows(index, lang, im ?? null, os ?? null, extra ?? null, q, subs);
    // 细节视图（os）没有自己的列表，复用时间线的「按角色」列表，保证左侧能看到当前档案
    const listView = view === "os" ? "timeline" : view;
    const listMode = view === "os" ? "version" : timelineMode;
    return rowsFor(
      index,
      listView,
      lang,
      view === "timeline" ? activeFilters : filters,
      listMode,
      view === "im" ? imFilter : "",
    );
  }, [index, view, lang, q, im, os, extra, subs, filters, activeFilters, timelineMode, imFilter]);

  const viewMeta = VIEWS.find((v) => v.id === view);

  const onSelect = (row: Row) => {
    setQuery("");
    if (row.kind === "group") {
      setFilters({ ...EMPTY_FILTERS, chapter: row.title });
      navigate("timeline");
      return;
    }
    // os 视图复用时间线列表，选中后仍留在 os 路由
    navigate(view === "os" && row.view === "timeline" ? "os" : row.view, row.id);
  };

  if (indexAsync.state === "loading") {
    return (
      <div className="app">
        <div style={{ gridColumn: "1 / -1" }}>
          <StateBlock title="正在加载剧情索引…" />
        </div>
      </div>
    );
  }
  if (indexAsync.state === "error") {
    return (
      <div className="app">
        <div style={{ gridColumn: "1 / -1" }}>
          <StateBlock title="数据加载失败">
            <p className="mono">{indexAsync.error.message}</p>
            <p>
              请先运行 <span className="mono">python cytus2_work/export_json.py</span> 生成{" "}
              <span className="mono">viewer/public/data/</span>。
            </p>
          </StateBlock>
        </div>
      </div>
    );
  }

  const data = indexAsync.data;

  return (
    <div className="app">
      <Sidebar
        view={view}
        counts={data.meta.counts}
        lang={lang}
        onView={(v) => {
          setQuery("");
          setImFilter("");
          navigate(v);
        }}
        onLang={setLang}
      />

      <div className="main">
        <header className="topbar">
          <h1>{viewMeta?.label ?? view}</h1>
          <span className="count">
            {q.length >= 2
              ? `${rows.length} 条命中`
              : view === "timeline" && timelineMode === "chapter" && !activeFilters.chapter
                ? `${rows.length} 章`
                : `${rows.length} 条`}
          </span>
          {view === "im" && index?.imFilters ? (
            <div className="lang" role="group" aria-label="iM 账户过滤">
              <button type="button" aria-pressed={imFilter === ""} onClick={() => setImFilter("")}>
                全部
              </button>
              {(index.imFilters.items ?? []).map((it) => (
                <button
                  key={it.avatar}
                  type="button"
                  aria-pressed={imFilter === it.avatar}
                  onClick={() => setImFilter(imFilter === it.avatar ? "" : it.avatar)}
                  title={it.avatars.join(" / ")}
                >
                  {it.name}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={imFilter === "other"}
                onClick={() => setImFilter(imFilter === "other" ? "" : "other")}
                title="不属于上述账号的帖子（粉丝 / 官方 / 杂项）"
              >
                其他
              </button>
            </div>
          ) : null}
          {view === "timeline" ? (
            <>
              <div className="lang" role="group" aria-label="时间线视图">
                {TIMELINE_MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={m.id === timelineMode}
                    onClick={() => {
                      setTimelineMode(m.id);
                      setFilters({
                        ...EMPTY_FILTERS,
                        // 进版本视图默认落在最新版本（游戏里也是先选版本号）
                        version:
                          m.id === "version" ? activeFilters.version || options.versions[0] || "" : "",
                      });
                    }}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              {timelineMode === "chapter" && activeFilters.chapter ? (
                <button
                  type="button"
                  className="chip chip-btn"
                  onClick={() => setFilters({ ...activeFilters, chapter: "", folder: "" })}
                >
                  ← 章节列表
                </button>
              ) : null}
              {timelineMode === "version" ? (
                <select
                  className="version-select"
                  aria-label="版本筛选"
                  value={activeFilters.version}
                  onChange={(e) => setFilters({ ...filters, version: e.target.value })}
                >
                  <option value="">全部版本</option>
                  {options.versions.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              ) : null}
              {timelineMode === "chapter" && activeFilters.chapter && options.folders.length > 1 ? (
                <select
                  className="version-select"
                  aria-label="文件夹筛选"
                  value={activeFilters.folder}
                  onChange={(e) => setFilters({ ...filters, folder: e.target.value })}
                >
                  <option value="">全部文件夹</option>
                  {options.folders.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              ) : null}
              {timelineMode === "version" && options.characters.length > 1 ? (
                <select
                  className="version-select"
                  aria-label="角色筛选"
                  value={activeFilters.character}
                  onChange={(e) => setFilters({ ...filters, character: e.target.value })}
                >
                  <option value="">全部角色</option>
                  {options.characters.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              ) : null}
              {hasFilters(activeFilters) && timelineMode === "version" ? (
                <button
                  type="button"
                  className="chip chip-btn"
                  onClick={() => setFilters(EMPTY_FILTERS)}
                >
                  清除筛选
                </button>
              ) : null}
            </>
          ) : null}
          <span className="spacer" />
          <div className="search">
            <span aria-hidden="true">⌕</span>
            <input
              ref={searchRef}
              type="search"
              value={query}
              placeholder="搜索帖子正文 / 档案内容 / ID"
              aria-label="搜索"
              onChange={(e) => setQuery(e.target.value)}
            />
            <kbd>/</kbd>
          </div>
          <button
            type="button"
            className="theme-toggle"
            onClick={toggleTheme}
            aria-pressed={theme === "light"}
            title="切换明暗主题"
          >
            {theme === "dark" ? "暗色" : "亮色"}
          </button>
        </header>

        <div className="split">
          <ListPane
            rows={rows}
            activeKey={route.id}
            onSelect={onSelect}
            emptyText={q.length >= 2 ? "没有命中，换个关键词试试。" : "该视图暂无条目。"}
          />
          <div className="reader" ref={readerRef}>
            {q.length >= 2 && rows.length === 0 ? (
              <StateBlock title="没有结果">
                <p>搜索覆盖当前语言的 iM 正文与 OS 档案全文（含标题、ID、章节名）。</p>
              </StateBlock>
            ) : (
              <Reader
            filters={activeFilters}
            onFilter={(patch) => {
              setFilters({ ...activeFilters, ...patch });
              navigate("timeline");
            }}
                index={data}
                lang={lang}
                view={view}
                id={route.id}
                im={im}
                os={os}
                extra={extra}
                loadingIm={imAsync.state === "loading"}
                loadingOs={osAsync.state === "loading"}
                loadingExtra={extraAsync.state === "loading"}
                onNavigate={(v, id) => {
                  setQuery("");
                  navigate(v, id);
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
