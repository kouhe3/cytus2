import type { IndexData } from "../types";
import { MEDIA_BASE, findCover, findIllustration, findImage, findMovie, useManifest } from "../media";
import { Video } from "../components/Media";
import { Avatar } from "../components/Avatar";
import { Chip, Facts, NavChip } from "../components/ui";

const ICON_LABEL: Record<string, string> = {
  icon_video: "影片",
  icon_image: "图片",
  icon_bossstage: "Boss 舞台",
};

const FORMAT_LABEL: Record<number, string> = {
  1: "video",
  2: "bossstage",
  3: "image",
  4: "format4",
  5: "format5",
};

function ConditionChips({
  conditions,
  onNavigate,
}: {
  conditions: string[];
  onNavigate: (view: string, id?: string) => void;
}) {
  return (
    <>
      {conditions.map((c) => {
        const [kind, id] = c.split(":", 2);
        if (kind === "os" && id) {
          return (
            <NavChip key={c} onClick={() => onNavigate("timeline", id)} title="打开对应 OS 档案">
              OS {id}
            </NavChip>
          );
        }
        if (kind === "im" && id) {
          return (
            <NavChip key={c} onClick={() => onNavigate("im", id)} title="打开对应 iM 帖">
              iM {id}
            </NavChip>
          );
        }
        if (kind === "branch" && id) {
          return (
            <NavChip key={c} onClick={() => onNavigate("branching", id)} title="打开分支节点">
              分支 {id}
            </NavChip>
          );
        }
        return (
          <Chip key={c} tone={kind === "story" ? "warn" : undefined}>
            {kind} {id ?? ""}
          </Chip>
        );
      })}
    </>
  );
}

function MediaCell({
  location,
  icon,
  format,
  lang,
}: {
  location: string;
  icon: string;
  format: number;
  lang?: string;
}) {
  const manifest = useManifest();
  // Format 3 = icon_image：备份数据库里的曲绘，纹理名与 FileLocation 一致
  const cover = findCover(manifest, location);
  if (cover) {
    return (
      <a href={MEDIA_BASE + encodeURI(cover.file)} target="_blank" rel="noreferrer">
        <img className="gallery-thumb" src={MEDIA_BASE + encodeURI(cover.file)} alt={location} loading="lazy" />
      </a>
    );
  }
  if (format === 3) return <span className="chip chip--warn">曲绘 · 未导出</span>;
  const video = findMovie(manifest, location);
  if (video) {
    return (
      <Video entry={video} id={location} lang={lang} />
    );
  }
  const image = findIllustration(manifest, location) ?? findImage(manifest, location, "os");
  if (image) {
    return (
      <a href={MEDIA_BASE + encodeURI(image.file)} target="_blank" rel="noreferrer">
        <img className="gallery-thumb" src={MEDIA_BASE + encodeURI(image.file)} alt={location} loading="lazy" />
      </a>
    );
  }
  return <span className="chip chip--warn">{ICON_LABEL[icon] ?? icon} · 未导出</span>;
}

export function GalleryReader({
  index,
  lang,
  folderId,
  onNavigate,
}: {
  index: IndexData;
  lang?: string;
  folderId: string;
  onNavigate: (view: string, id?: string) => void;
}) {
  const folder = index.gallery.folders.find((f) => f.id === folderId);
  if (!folder) return <p className="state">未找到备份数据库文件夹 {folderId}。</p>;
  const items = index.gallery.items.filter((i) => i.folder === folderId);

  return (
    <div className="reader-inner">
      <div className="crumbs">
        <button type="button" className="chip chip-btn" onClick={() => onNavigate("backup")}>
          Backup Database
        </button>{" "}
        <Chip>{items.length} 个文件</Chip>
      </div>
      <div className="author-row">
        <Avatar id={folder.avatar} size={40} name={folder.name} />
        <span className="who">
          <b>{folder.name}</b>
          <span>{folder.id}</span>
        </span>
      </div>
      <p className="lede">
        备份数据库（gallerydata）：每个角色文件夹下的影片 / 图片 / Boss 舞台记录，解锁条件挂在 OS 档案或剧情步上。
      </p>
      <Facts
        items={[
          ["影片", items.filter((i) => i.icon === "icon_video").length],
          ["图片", items.filter((i) => i.icon === "icon_image").length],
          ["Boss 舞台", items.filter((i) => i.icon === "icon_bossstage").length],
        ]}
      />

      <table className="grid">
        <thead>
          <tr>
            <th style={{ width: 96 }}>类型</th>
            <th>文件</th>
            <th style={{ width: 130 }}>Location</th>
            <th style={{ width: 220 }}>解锁条件</th>
            <th style={{ width: 190 }}>媒体</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={`${it.folder}-${it.location}-${it.name}`}>
              <td className="mono">{ICON_LABEL[it.icon] ?? it.icon}</td>
              <td>
                {it.name}
                <div className="mono">{FORMAT_LABEL[it.format] ?? it.format}</div>
              </td>
              <td className="mono">
                {it.location}
                {it.size ? (
                  <div className="mono" style={{ color: "var(--muted)" }}>
                    {it.size[0]}×{it.size[1]}
                  </div>
                ) : null}
              </td>
              <td>
                <div className="chips">
                  <ConditionChips conditions={it.conditions} onNavigate={onNavigate} />
                </div>
              </td>
              <td>
                <MediaCell location={it.location} icon={it.icon} format={it.format} lang={lang} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
