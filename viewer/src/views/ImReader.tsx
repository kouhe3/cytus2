import type { ImMeta, ImText, IndexData, Lang, ReplyNode } from "../types";
import { Chip, Facts, NavChip, Skeleton } from "../components/ui";
import { Avatar } from "../components/Avatar";
import { InlineImage } from "../components/Media";
import { findImage, useManifest } from "../media";

function Replies({ nodes, onNavigate }: { nodes: ReplyNode[]; onNavigate: (view: string, id?: string) => void }) {
  if (nodes.length === 0) return null;
  return (
    <ul className="replies">
      {nodes.map((r) => (
        <li className="reply" key={r.id}>
          <div className="reply-head">
            <Avatar id={r.avatar} size={24} name={r.author} />
            <b>{r.author}</b>
            <span>{r.id}</span>
            <span style={{ opacity: 0.6 }}>{r.avatar}</span>
            {r.attachments.length > 0 ? <span>附件 {r.attachments.join("、")}</span> : null}
          </div>
          <p>{r.text}</p>
          <Replies nodes={r.replies} onNavigate={onNavigate} />
        </li>
      ))}
    </ul>
  );
}

export function ImReader({
  index,
  lang,
  meta,
  text,
  loading,
  onNavigate,
}: {
  index: IndexData;
  lang: Lang;
  meta: ImMeta;
  text?: ImText;
  loading: boolean;
  onNavigate: (view: string, id?: string) => void;
}) {
  const sync = index.sync.filter((s) => s.im.includes(meta.id) && s.os.length > 0);
  const gate = index.gates.find((g) => g.id === meta.gate);
  const prev = index.im[meta.order - 2];
  const next = index.im[meta.order];
  const manifest = useManifest();
  const attachments = meta.attachments
    .map((id) => ({ id, entry: findImage(manifest, id, "im") }))
    .filter((a) => a.entry !== undefined);

  return (
    <div className="reader-inner">
      <div className="crumbs">
        <button type="button" className="chip chip-btn" onClick={() => onNavigate("im")}>
          iM 社群
        </button>{" "}
        <Chip>#{meta.order} / {index.im.length}</Chip>
      </div>

      <div className="author-row">
        <Avatar id={meta.avatar} size={48} name={meta.author} />
        <span className="who">
          <b>{meta.author}</b>
          <span>{meta.avatar}</span>
        </span>
      </div>
      <h2>{text?.title || meta.titles[lang] || meta.id}</h2>
      <p className="lede">
        <span className="mono">{meta.id}</span> · 第 {meta.order} 帖 / 共 {index.im.length} 帖
      </p>

      <Facts
        items={[
          ["点赞", meta.likes],
          ["回复", meta.replies],
          ["剧情闸", meta.gate || "无"],
        ]}
      />

      <div className="chips">
        {meta.packs.map(([pack, level]) => (
          <NavChip key={`${pack}:${level}`} onClick={() => onNavigate("packs", pack)}>
            {pack} · Lv{level}
          </NavChip>
        ))}
        {gate ? (
          <NavChip tone="warn" onClick={() => onNavigate("gates", gate.id)}>
            由 {gate.id} 解锁
          </NavChip>
        ) : null}
        {meta.storyTrigger ? (
          <Chip tone="warn" title="该帖是剧情触发点：触发后可能从 iM 列表移除">
            ⚑ 剧情触发帖 · {meta.storyTrigger.story}
          </Chip>
        ) : null}
        {meta.attachments.map((a) => (
          <Chip key={a}>附件 {a}</Chip>
        ))}
        {meta.charts.map((c, i) => (
          <Chip key={i}>
            {c.SongId ?? "chart"} · {c.Difficulty ?? "?"}
          </Chip>
        ))}
      </div>

      {loading ? (
        <Skeleton rows={5} />
      ) : (
        <>
          {attachments.length > 0 ? (
            <div className="attachments">
              {attachments.map((a) => (
                <InlineImage key={a.id} entry={a.entry!} id={a.id} label="附件" />
              ))}
            </div>
          ) : null}
          <div className="im-body">{text?.text || "（该语言无正文）"}</div>
          <h3>回复 {text ? `· ${meta.replies}` : ""}</h3>
          <Replies nodes={text?.replies ?? []} onNavigate={onNavigate} />
        </>
      )}

      {sync.length > 0 ? (
        <>
          <h3>同一刻解锁的 OS 条目</h3>
          <div className="chips">
            {sync.map((s) =>
              s.os.map((id) => (
                <NavChip key={`${s.pack}-${s.level}-${id}`} onClick={() => onNavigate("timeline", id)} title={`${s.pack} Lv${s.level}`}>
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
            <button type="button" className="chip chip-btn" onClick={() => onNavigate("im", prev.id)}>
              ← {prev.id}
            </button>
          ) : null}
        </span>
        <span>
          {next ? (
            <button type="button" className="chip chip-btn" onClick={() => onNavigate("im", next.id)}>
              {next.id} →
            </button>
          ) : null}
        </span>
      </div>
    </div>
  );
}
