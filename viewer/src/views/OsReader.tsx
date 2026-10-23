import type { ArchiveFilters } from "../rows";
import type { IndexData, Lang, OsMeta, OsText } from "../types";
import { dispLevel, formatDate } from "../data";
import { Script } from "../components/Script";
import { Video } from "../components/Media";
import { findMovie, useManifest } from "../media";
import { Chip, Facts, NavChip, Skeleton } from "../components/ui";

export function OsReader({
  index,
  lang,
  meta,
  text,
  loading,
  onNavigate,
  onFilter,
}: {
  index: IndexData;
  lang: Lang;
  meta: OsMeta;
  text?: OsText;
  loading: boolean;
  onNavigate: (view: string, id?: string) => void;
  onFilter: (patch: Partial<ArchiveFilters>) => void;
}) {
  const siblings = index.os.filter((e) => e.file === meta.file).sort((a, b) => a.index - b.index);
  const at = siblings.findIndex((e) => e.id === meta.id);
  const prev = at > 0 ? siblings[at - 1] : undefined;
  const next = at >= 0 && at < siblings.length - 1 ? siblings[at + 1] : undefined;
  const sync = index.sync.filter((s) => s.os.includes(meta.id) && s.im.length > 0);
  const manifest = useManifest();
  const cutscene = meta.cutscene ? findMovie(manifest, meta.cutscene) : undefined;

  return (
    <div className="reader-inner">
      <div className="crumbs">
        <button type="button" className="chip chip-btn" onClick={() => onNavigate("timeline")}>
          Timeline OS
        </button>{" "}
        <button
          type="button"
          className="chip chip-btn"
          onClick={() => onFilter({ chapter: meta.chapter, folder: "" })}
        >
          {meta.chapter}
        </button>{" "}
        <button type="button" className="chip chip-btn" onClick={() => onFilter({ folder: meta.folder })}>
          {meta.folder}
        </button>
      </div>

      <h2>{text?.name || meta.names[lang] || meta.id}</h2>
      {cutscene ? (
        <>
          <Video entry={cutscene} id={meta.cutscene!} lang={lang} />
          <p className="lede">首次打开该档案时播放的过场影片（cutscenedata / cutscene_data_os，含内嵌字幕轨）。</p>
        </>
      ) : null}
      <p className="lede">
        <span className="mono">{meta.id}</span> · 档案 <span className="mono">{meta.file}</span> · 编号{" "}
        <span className="mono">{meta.category ?? "—"}</span>
      </p>

      <Facts
        items={[
          ["Index", meta.index],
          ["日期", formatDate(meta.date)],
          ["类型", meta.type],
          ["前置", meta.fileLock || "—"],
        ]}
      />

      <div className="chips">
        {(() => {
          const story = index.storyEvents?.find((e) =>
            [e.trigger_topic_id, e.start_topic_id, e.end_topic_id].includes(meta.id),
          );
          return story ? (
            <NavChip tone="warn" onClick={() => onNavigate("gates", story.id)} title="这条档案会触发剧情">
              ⚑ 读后触发剧情：{story.id}
            </NavChip>
          ) : null;
        })()}
        {meta.packs.map(([pack, level]) => (
          <NavChip key={`${pack}:${level}`} onClick={() => onNavigate("packs", pack)} title="打开等级解锁（该角色的等级阶梯）">
            {pack} · Lv{level}
          </NavChip>
        ))}
        {meta.movies.map((m) => (
          <Chip key={m} tone="warn" title="影片未导出，字幕在 raw/srt/">
            ▶ {m}
          </Chip>
        ))}
      </div>

      {loading ? <Skeleton rows={6} /> : text ? <Script blocks={text.blocks} lang={lang} /> : <p className="state">缺少该语言文本。</p>}

      {sync.length > 0 ? (
        <>
          <h3>同一等级同时解锁的 iM 帖</h3>
          <div className="chips">
            {sync.map((s) =>
              s.im.map((id) => (
                <NavChip key={`${s.pack}-${s.level}-${id}`} onClick={() => onNavigate("im", id)} tone="accent" title={`${s.pack} Lv${dispLevel(s.level)}`}>
                  {id}
                </NavChip>
              )),
            )}
          </div>
        </>
      ) : null}

      <div className="pager">
        <span>
          {prev ? (
            <button type="button" className="chip chip-btn" onClick={() => onNavigate("timeline", prev.id)}>
              ← {prev.id}
            </button>
          ) : null}
        </span>
        <span>
          {next ? (
            <button type="button" className="chip chip-btn" onClick={() => onNavigate("timeline", next.id)}>
              {next.id} →
            </button>
          ) : null}
        </span>
      </div>
    </div>
  );
}
