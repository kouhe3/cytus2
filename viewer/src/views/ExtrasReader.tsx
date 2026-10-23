import type { ExtraContent, IndexData } from "../types";
import { useState } from "react";
import { MEDIA_BASE, findMovie, findVideoWithSong, useManifest } from "../media";
import { loadEndplayMap, loadSubsIndex, useAsync, formatClock } from "../data";
import { Video } from "../components/Media";
import { Skeleton } from "../components/ui";

/** title_info.Type -> video_title_* 片段（依据 Title01..Title06 与特殊命名的先后关系推断） */
const TITLE_CLIPS: Record<number, string[]> = {
  0: ["title01"],
  1: ["title02"],
  2: ["title03_1", "title03_2"],
  3: ["title04"],
  4: ["title05_1", "title05_2"],
  5: ["title06_1", "title06_2"],
  6: ["goodEndTitle"],
  7: ["goodEndTitle"],
  8: ["VanessaLv11Title"],
  9: ["trueEndTitle"],
};

function IllustrationSection({
  index,
  onNavigate,
}: {
  index: IndexData;
  onNavigate: (view: string, id?: string) => void;
}) {
  const manifest = useManifest();
  const byChar = new Map<string, typeof index.illustrations>();
  for (const item of index.illustrations) {
    if (!byChar.has(item.characterName)) byChar.set(item.characterName, []);
    byChar.get(item.characterName)!.push(item);
  }
  return (
    <div className="reader-inner">
      <div className="crumbs">
        <button type="button" className="chip chip-btn" onClick={() => onNavigate("extras")}>
          附录
        </button>
      </div>
      <h2>角色立绘</h2>
      <p className="lede">
        {index.illustrations.length} 张立绘（illustrationdata + illustration_*.ab），每张 640×852，按角色与造型分组；
        「全灭结局」是该角色全灭结局（bad ending）里的立绘，来自 <span className="mono">broken_illustration_*.ab</span>。
      </p>
      {[...byChar.entries()].map(([characterName, items]) => {
        const brokenKey = `broken_illustration_${items[0].character}`;
        const broken = manifest?.illustrations?.[brokenKey];
        return (
          <section key={characterName}>
            <h3>{characterName}</h3>
            <div className="logo-grid">
              {items.map((item) => {
                const entry = manifest?.illustrations?.[`illustration_${item.id}`];
                return (
                  <figure key={item.id} className="logo-card">
                    {entry ? (
                      <a href={MEDIA_BASE + encodeURI(entry.file)} target="_blank" rel="noreferrer">
                        <img
                          src={MEDIA_BASE + encodeURI(entry.file)}
                          alt={`${characterName} ${item.costume}`}
                          loading="lazy"
                        />
                      </a>
                    ) : (
                      <span className="chip chip--warn">未导出</span>
                    )}
                    <figcaption>
                      <b>{item.costume || item.id}</b>
                      <span className="mono">
                        {item.id}
                        {entry ? ` · ${entry.w}×${entry.h}` : ""}
                      </span>
                    </figcaption>
                  </figure>
                );
              })}
              {broken ? (
                <figure className="logo-card">
                  <a href={MEDIA_BASE + encodeURI(broken.file)} target="_blank" rel="noreferrer">
                    <img src={MEDIA_BASE + encodeURI(broken.file)} alt={`${characterName} 全灭结局`} loading="lazy" />
                  </a>
                  <figcaption>
                    <b>全灭结局</b>
                    <span className="mono">
                      {brokenKey} · {broken.w}×{broken.h}
                    </span>
                  </figcaption>
                </figure>
              ) : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function LogoSection({ onNavigate }: { onNavigate: (view: string, id?: string) => void }) {
  const manifest = useManifest();
  const logos = Object.entries(manifest?.logos ?? {});
  return (
    <div className="reader-inner">
      <div className="crumbs">
        <button type="button" className="chip chip-btn" onClick={() => onNavigate("extras")}>
          附录
        </button>
      </div>
      <h2>图标与 LOGO</h2>
      <p className="lede">
        {logos.length} 个标志，来自 `split_base_assets.apk` 的 `assets/bin/Data`（曲包图标 `pack_icon_*`、联名
        `capsopack_icon_*`、品牌 `RayarkLogo` / `C2Logo` 等）。点图片可直接下载原图。
      </p>
      <div className="logo-grid">
        {logos.map(([name, entry]) => (
          <figure key={name} className="logo-card">
            <a href={MEDIA_BASE + encodeURI(entry.file)} target="_blank" rel="noreferrer" download>
              <img src={MEDIA_BASE + encodeURI(entry.file)} alt={name} loading="lazy" />
            </a>
            <figcaption>
              <b>{name}</b>
              <span className="mono">
                {entry.w}×{entry.h}
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

/** 同一段影片可能配多首曲目（终战两条分支）：字幕 `X_2` 优先配曲目 `X_2`，否则退回第一首 */
function pickSong(key: string, songs: string[]): string | undefined {
  if (songs.length === 0) return undefined;
  return songs.find((s) => s === key) ?? songs.find((s) => key.endsWith(s.slice(-2))) ?? songs[0];
}

/** 字幕 ↔ 过场影片对照。字幕来自 srtfile_*.ab，影片来自 video_story_* / video_endplay_* / video_trueend_*。 */
function CutsceneSection({ onNavigate }: { onNavigate: (view: string, id?: string) => void }) {
  const manifest = useManifest();
  const subsIndex = useAsync(loadSubsIndex, []);
  const endplay = useAsync(loadEndplayMap, []);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const matches = new Map<string, { lang: string; t: number; text: string }[]>();
  if (q && subsIndex.state === "ready") {
    for (const [key, langs] of Object.entries(subsIndex.data)) {
      for (const [lang, cues] of Object.entries(langs)) {
        for (const [t, , text] of cues) {
          if (!text.toLowerCase().includes(q)) continue;
          if (!matches.has(key)) matches.set(key, []);
          matches.get(key)!.push({ lang, t, text });
        }
      }
    }
  }
  const subs = Object.entries(manifest?.subtitles ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const videos = Object.entries(manifest?.videos ?? {});
  const used = new Set<string>();
  const rows = subs.map(([key, langs]) => {
    const base = key.replace(/_\d+$/, "");
    const entry = findMovie(manifest, key) ?? findMovie(manifest, base);
    if (entry) {
      for (const [name, e] of videos) if (e.file === entry.file) used.add(name);
    }
    return { key, langs: Object.keys(langs), entry, base };
  });
  const rest = videos.filter(([name]) => !used.has(name));
  return (
    <div className="reader-inner">
      <div className="crumbs">
        <button type="button" className="chip chip-btn" onClick={() => onNavigate("extras")}>
          附录
        </button>
      </div>
      <h2>过场影片与字幕</h2>
      <p className="lede">
        {subs.length} 组字幕（<span className="mono">srtfile_*.ab</span> → WebVTT，每组 5 语言），影片来自{" "}
        <span className="mono">video_story_* / video_endplay_* / video_trueend_*</span>，共 {videos.length} 段。
        字幕名与影片名不一定同名：<span className="mono">FinalBossStage_1/2</span> 对应影片{" "}
        <span className="mono">FinalBossStage</span>（终战结场动画的两条分支字幕），这里按「去掉 <span className="mono">_1</span>{" "}
        之类的分片后缀」配对，两边都播放同一段动画。
      </p>
      <p className="lede">
        结场动画（<span className="mono">video_endplay_*</span>）本身<b>没有音轨</b>：VideoClip 里只有 H.264，
        声音由同时播放的曲目负责（<span className="mono">IEndPlayEvent.EndPlaySongInfo</span>，见{" "}
        <span className="mono">dump.cs</span>）。曲目音频在 <span className="mono">songdata_&lt;曲目&gt;.ab</span> 里，
        已按「视频流 copy + 曲目 AAC」合成带音轨版本（<span className="mono">videos/&lt;影片&gt;__&lt;曲目&gt;.mp4</span>）；
        终战的两条分支各用自己那首（<span className="mono">_1</span> 行只列 <span className="mono">FinalBossStage_1</span>）。
      </p>
      <div className="oa-art" style={{ margin: "10px 0 4px" }}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="按字幕正文搜索「这句台词属于哪段过场动画」"
          style={{ padding: "6px 10px", minWidth: 360, fontSize: 13 }}
        />
      </div>
      {q ? (
        subsIndex.state === "loading" ? (
          <p className="mono">索引加载中…</p>
        ) : matches.size === 0 ? (
          <p className="mono">字幕正文里没有匹配「{query}」的台词。</p>
        ) : (
          <div>
            <p className="lede">
              {matches.size} 组字幕、{[...matches.values()].reduce((n, m) => n + m.length, 0)} 处匹配：
            </p>
            {[...matches.entries()].map(([key, hits]) => {
              const base = key.replace(/_\d+$/, "");
              const entry = findMovie(manifest, key) ?? findMovie(manifest, base);
              return (
                <details key={key} open={matches.size <= 3}>
                  <summary className="mono">
                    {key} · {hits.length} 处 · {formatClock(hits[0].t)} 起 · 影片 {base}
                  </summary>
                  <ul className="mono" style={{ lineHeight: 1.7 }}>
                    {hits.slice(0, 12).map((h, i) => (
                      <li key={i}>
                        [{formatClock(h.t)}] {h.lang} · {h.text}
                      </li>
                    ))}
                    {hits.length > 12 ? <li>…… 其余 {hits.length - 12} 处</li> : null}
                  </ul>
                  {entry ? <Video entry={entry} id={base} subtitleKey={key} startAt={hits[0].t} /> : null}
                </details>
              );
            })}
          </div>
        )
      ) : null}
      <table className="grid">
        <thead>
          <tr>
            <th style={{ width: 220 }}>字幕</th>
            <th style={{ width: 130 }}>语言</th>
            <th>对应影片 / 游戏内配乐</th>
            <th style={{ width: 130 }}>播放</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ key, langs, entry, base }) => (
            <tr key={key}>
              <td className="mono">{key}</td>
              <td className="mono">{langs.join(" / ")}</td>
              <td className="mono">
                {entry ? (
                  <>
                    {base} · {entry.w}×{entry.h} · {entry.frames}f
                  </>
                ) : (
                  <span className="chip chip--warn">无影片</span>
                )}
                {(() => {
                  const items = endplay.state === "ready" ? endplay.data[base] ?? endplay.data[key] : undefined;
                  const song = pickSong(key, items?.map((it) => it.song) ?? []);
                  const hit = items?.find((it) => it.song === song);
                  return song ? (
                    <>
                      <div style={{ color: "var(--muted)" }}>♪ {song} · 游戏内配乐</div>
                      {hit?.condition ? (
                        <div style={{ color: "var(--muted)", fontSize: 12 }}>前提：{hit.condition}</div>
                      ) : null}
                      {hit?.after ? (
                        <div style={{ color: "var(--muted)", fontSize: 12 }}>之后：{hit.after}</div>
                      ) : null}
                      {hit?.prereq ? (
                        <details>
                          <summary className="mono">前置过场 ▶ {hit.prereq}</summary>
                          {(() => {
                            const pre = findMovie(manifest, hit.prereq!);
                            return pre ? <Video entry={pre} id={hit.prereq!} /> : null;
                          })()}
                        </details>
                      ) : null}
                    </>
                  ) : null;
                })()}
              </td>
              <td>
                {entry ? (
                  (() => {
                    const songs =
                      endplay.state === "ready"
                        ? (endplay.data[base] ?? endplay.data[key])?.map((it) => it.song) ?? []
                        : [];
                    const song = pickSong(key, songs);
                    const hit = song ? findVideoWithSong(manifest, base, song) : undefined;
                    return (
                      <details>
                        <summary className="mono">{hit?.labeled ? `♪ ${song}` : "展开播放器"}</summary>
                        <Video entry={hit?.entry ?? entry} id={base} subtitleKey={key} />
                      </details>
                    );
                  })()
                ) : (
                  <span className="mono">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>其余影片（无字幕，{rest.length} 段）</h3>
      <p className="lede">
        这些片段（剧情过场 / 标题循环 / OA 场景）本身没有字幕文件，影片已导出，可直接播放；标「无音轨」的是
        <span className="mono">video_endplay_*</span> / <span className="mono">video_oasystem_*</span>，它们的配乐见上表。
      </p>
      <div className="title-grid">
        {rest.map(([name, e]) => {
          const songs =
            endplay.state === "ready" ? (endplay.data[name] ?? [])?.map((it) => it.song) ?? [] : [];
          const muxed = songs
            .map((song) => ({ song, hit: manifest?.videoAudio?.[`${name}|${song}`] }))
            .filter((x) => x.hit);
          return (
            <div key={name}>
              <div className="mono">
                {name} · {e.w}×{e.h} · {e.frames}f{!e.hasAudio ? " · 无音轨" : ""}
              </div>
              {(muxed.length ? muxed : [{ song: undefined, hit: undefined }]).map(({ song, hit }) => (
                <Video key={song ?? "silent"} entry={hit ?? e} id={song ? `${name}（${song}）` : name} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ExtrasReader({
  index,
  section,
  extra,
  loading,
  onNavigate,
}: {
  index: IndexData;
  section: string;
  extra?: ExtraContent;
  loading: boolean;
  onNavigate: (view: string, id?: string) => void;
}) {
  if (loading) {
    return (
      <div className="reader-inner">
        <Skeleton rows={8} />
      </div>
    );
  }
  if (section === "audio") {
    return (
      <div className="reader-inner">
        <div className="crumbs">
          <button type="button" className="chip chip-btn" onClick={() => onNavigate("extras")}>
            附录
          </button>
        </div>
        <h2>语音字幕</h2>
        <p className="lede">{extra?.audio.length ?? 0} 条角色语音（audiosubtitledata）</p>
        <table className="grid">
          <thead>
            <tr>
              <th style={{ width: 90 }}>AudioId</th>
              <th style={{ width: 140 }}>角色</th>
              <th>字幕</th>
            </tr>
          </thead>
          <tbody>
            {extra?.audio.map((a) => (
              <tr key={a.id}>
                <td className="mono">{a.id}</td>
                <td>{a.character}</td>
                <td style={{ whiteSpace: "pre-wrap" }}>{a.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (section === "assistants") {
    return (
      <div className="reader-inner">
        <div className="crumbs">
          <button type="button" className="chip chip-btn" onClick={() => onNavigate("extras")}>
            附录
          </button>
        </div>
        <h2>iM 助手对话</h2>
        <p className="lede">{extra?.assistants.length ?? 0} 组（im_assistant_data）</p>
        {extra?.assistants.map((a) => (
          <div key={a.id}>
            <h3>
              {a.id} · trigger {a.trigger ?? "—"} · target {a.target ?? "—"}
            </h3>
            {a.pages.map((p, i) => (
              <p className="nar" key={i}>
                {p}
              </p>
            ))}
          </div>
        ))}
      </div>
    );
  }
  if (section === "illustrations") {
    return <IllustrationSection index={index} onNavigate={onNavigate} />;
  }
  if (section === "logos") {
    return <LogoSection onNavigate={onNavigate} />;
  }
  if (section === "cutscenes") {
    return <CutsceneSection onNavigate={onNavigate} />;
  }
  const manifest = useManifest();
  const allTitles = Object.entries(manifest?.titles ?? {});
  return (
    <div className="reader-inner">
      <div className="crumbs">
        <button type="button" className="chip chip-btn" onClick={() => onNavigate("extras")}>
          附录
        </button>
      </div>
      <h2>标题画面演进</h2>
      <p className="lede">
        {index.titleInfo.length} 个标题（titleinfodata），由剧情闸解锁；标题动画来自 `video_title_*`，共 {allTitles.length} 段。
        Type → 影片的对应按 `Title01`–`Title06` 的顺序与特殊命名（goodEnd / trueEnd / VanessaLv11）推断，`title03/05/06` 各含 2 段（开场 + 循环）。
      </p>
      <table className="grid">
        <thead>
          <tr>
            <th style={{ width: 56 }}>Type</th>
            <th style={{ width: 150 }}>名称</th>
            <th style={{ width: 190 }}>解锁条件</th>
            <th>标题影片</th>
          </tr>
        </thead>
        <tbody>
          {index.titleInfo.map((t) => (
            <tr key={t.Type}>
              <td className="mono">{t.Type}</td>
              <td>{t.Name}</td>
              <td className="mono">{(t.Conditions ?? []).map((c) => c.storyId).filter(Boolean).join("、") || "—"}</td>
              <td>
                <div className="title-clips">
                  {(TITLE_CLIPS[t.Type] ?? []).map((clip) => {
                    const entry = manifest?.titles?.[clip] ?? findMovie(manifest, clip);
                    if (!entry) return <span key={clip} className="chip chip--warn">{clip}（未导出）</span>;
                    return <Video key={clip} entry={entry} id={clip} />;
                  })}
                  {(TITLE_CLIPS[t.Type] ?? []).length === 0 ? <span className="mono">—</span> : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>全部标题影片（{allTitles.length}）</h3>
      <div className="title-grid">
        {allTitles.map(([name, entry]) => (
          <div key={name}>
            <div className="mono">{name} · {entry.w}×{entry.h} · {entry.frames}f</div>
            <Video entry={entry} id={name} />
          </div>
        ))}
      </div>
    </div>
  );
}
