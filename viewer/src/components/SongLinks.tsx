import type { SongCatalog } from "../types";
import { NavChip } from "./ui";
import { DIFF_LABEL, groupBySong, songIndex, songsRoute, type ChartRef } from "../songs";

/**
 * 谱面 → 「歌曲与获取方式」的反向引用：
 * 每个曲目一行 chip，点进 extras/songs|<songId> 会展开对应曲包并高亮该曲。
 */
export function SongLinks({
  charts,
  catalog,
  onNavigate,
}: {
  charts: ChartRef[];
  catalog?: SongCatalog;
  onNavigate: (view: string, id?: string) => void;
}) {
  if (charts.length === 0) return null;
  const meta = songIndex(catalog);
  return (
    <div className="chips">
      {groupBySong(charts).map(({ song, diffs }) => {
        const info = meta.get(song);
        const diffText = diffs.map((d) => DIFF_LABEL[d] ?? `难度 ${d}`).join(" / ");
        return (
          <NavChip
            key={song}
            onClick={() => onNavigate("extras", songsRoute(song))}
            title={`${song}${info ? ` · ${info.artist}` : ""} · 打开歌曲与获取方式`}
          >
            {info ? `${info.name} · ${diffText}` : `${song} · ${diffText}`}
          </NavChip>
        );
      })}
    </div>
  );
}
