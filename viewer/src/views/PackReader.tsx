import type { IndexData, Lang } from "../types";
import { characterName } from "../data";
import { Chip, Facts } from "../components/ui";

export function PackReader({
  index,
  lang,
  packId,
  onNavigate,
}: {
  index: IndexData;
  lang: Lang;
  packId: string;
  onNavigate: (view: string, id?: string) => void;
}) {
  const pack = index.packs.find((p) => p.id === packId);
  if (!pack) return <p className="state">未找到曲包 {packId}。</p>;
  const imById = new Map(index.im.map((t) => [t.id, t]));
  const osById = new Map(index.os.map((e) => [e.id, e]));

  return (
    <div className="reader-inner">
      <div className="crumbs">
        <button type="button" className="chip chip-btn" onClick={() => onNavigate("packs")}>
          曲包阶梯
        </button>{" "}
        <Chip>同步点 {pack.syncCount}</Chip>
      </div>
      <h2>{characterName(index, pack.id)}</h2>
      <p className="lede">
        曲包 <span className="mono">{pack.id}</span> · 角色 {characterName(index, pack.id)}。
        同一 level 上，iM 帖与 OS 条目同时解锁 —— 这是两条轨道之间唯一可验证的交点。
      </p>
      <Facts
        items={[
          ["iM", pack.imCount],
          ["OS", pack.osCount],
          ["关联档案", pack.folders.slice(0, 4).join("、") || "—"],
        ]}
      />
      <div className="chips">
        {pack.chapters.slice(0, 8).map(([name, n]) => (
          <Chip key={name}>
            {name} · {n}
          </Chip>
        ))}
      </div>

      <div className="ladder">
        <div className="ladder-row" aria-hidden="true">
          <span className="ladder-lv" />
          <span className="group-title" style={{ padding: 0 }}>iM 帖</span>
          <span className="group-title" style={{ padding: 0 }}>OS 条目</span>
        </div>
        {pack.levels.map((row) => (
          <div className="ladder-row" key={row.level}>
            <span className="ladder-lv">Lv{row.level}</span>
            <span>
              {row.im.length === 0 ? <span className="mono">—</span> : null}
              {row.im.map((id) => (
                <button
                  type="button"
                  key={id}
                  className="pill pill--im"
                  title={imById.get(id)?.titles[lang]}
                  onClick={() => onNavigate("im", id)}
                >
                  {id}
                </button>
              ))}
            </span>
            <span>
              {row.os.length === 0 ? <span className="mono">—</span> : null}
              {row.os.map((id) => (
                <button
                  type="button"
                  key={id}
                  className="pill pill--os"
                  title={`${osById.get(id)?.chapter ?? ""} · ${osById.get(id)?.names[lang] ?? ""}`}
                  onClick={() => onNavigate("timeline", id)}
                >
                  {id}
                </button>
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
