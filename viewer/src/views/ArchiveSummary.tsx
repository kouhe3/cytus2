import type { ArchiveFilters } from "../rows";
import type { IndexData, Lang } from "../types";
import { formatDate } from "../data";
import { Chip, Facts } from "../components/ui";

export function Overview({ index }: { index: IndexData }) {
  const c = index.meta.counts;
  return (
    <div className="reader-inner">
      <h2>Cytus II 剧情阅览</h2>
      <p className="lede">
        档案总览：用上方筛选器按章节 / 版本号 / 角色收窄，点左侧任一条目开始阅读。
      </p>
      <div className="chips">
        <Chip>
          iM {c.imTopics} 帖 / {c.imReplies} 回复
        </Chip>
        <Chip>OS {c.osEntries} 条</Chip>
        <Chip>章节 {c.chapters}</Chip>
        <Chip>曲包 {c.packs}</Chip>
        <Chip>同步点 {c.syncPoints}</Chip>
        <Chip>OA {c.oaObjects} 物件</Chip>
        <Chip>Backup {c.backupNodes}</Chip>
      </div>
      <p className="lede" style={{ marginTop: 18 }}>
        游戏版本 {index.meta.gameVersion}。数据来自 base.apk + split_assets_pack 的 Unity AssetBundle，
        结构化导出为 <span className="mono">index.json</span> 与按语言拆分的{" "}
        <span className="mono">content.*.json</span>。
      </p>
    </div>
  );
}

/** 筛选后的章节 / 角色档案摘要，替代原先独立的「章节」「角色档案」两个视图 */
export function ArchiveSummary({
  index,
  lang,
  filters,
  onNavigate,
  onFilter,
}: {
  index: IndexData;
  lang: Lang;
  filters: ArchiveFilters;
  onNavigate: (view: string, id?: string) => void;
  onFilter: (patch: Partial<ArchiveFilters>) => void;
}) {
  const chapter = filters.chapter
    ? index.chapters.find((c) => c.name === filters.chapter)
    : undefined;
  const folder = filters.folder ? index.folders.find((f) => f.name === filters.folder) : undefined;

  if (!chapter && !folder) return <Overview index={index} />;

  return (
    <div className="reader-inner">
      <div className="crumbs">
        <button type="button" className="chip chip-btn" onClick={() => onFilter({ chapter: "", folder: "" })}>
          档案总览
        </button>
        {chapter ? <Chip>{chapter.category === 0 ? "主线" : "联动"}</Chip> : null}
      </div>

      {chapter ? (
        <>
          <h2>{chapter.name}</h2>
          <p className="lede">
            文件夹 {chapter.folders.length} 个 · 条目 {chapter.count} 条 · Index {chapter.index[0]}–
            {chapter.index[1]}
          </p>
          <Facts
            items={[
              [
                "世界时间",
                chapter.date
                  ? `${formatDate(chapter.date[0])} → ${formatDate(chapter.date[1])}`
                  : "—",
              ],
              ["时间倒序偏差", chapter.inversions],
              ["含影片", chapter.movies],
            ]}
          />
          <div className="chips">
            {chapter.packs.slice(0, 8).map(([pack]) => (
              <button
                type="button"
                key={pack}
                className="chip chip-btn"
                onClick={() => onNavigate("packs", pack)}
              >
                {pack}
              </button>
            ))}
          </div>
        </>
      ) : null}

      {folder ? (
        <>
          <h2 style={{ marginTop: chapter ? 24 : 0 }}>{folder.name}</h2>
          <p className="lede">
            OS 文件夹 · 条目 {folder.count} 条 · 章节 {folder.chapters.join("、")}
          </p>
          <div className="chips">
            {folder.chapters.map((name) => (
              <button
                type="button"
                key={name}
                className="chip chip-btn"
                onClick={() => onFilter({ chapter: name })}
              >
                {name}
              </button>
            ))}
            {folder.packs.slice(0, 6).map((pack) => (
              <button
                type="button"
                key={pack}
                className="chip chip-btn"
                onClick={() => onNavigate("packs", pack)}
              >
                {pack}
              </button>
            ))}
          </div>
        </>
      ) : null}

      <p className="lede" style={{ marginTop: 18 }}>
        {lang === "zh-Hans" ? "左侧列表已按此筛选，点条目阅读全文。" : "左侧列表已按此筛选。"}
      </p>
    </div>
  );
}
