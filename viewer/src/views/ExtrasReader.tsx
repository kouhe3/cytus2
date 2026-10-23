import type { ExtraContent, IndexData, Lang } from "../types";
import { useState } from "react";
import { MEDIA_BASE, findMovie, findVideoWithSong, useManifest } from "../media";
import type { SongCatalog } from "../types";
import { characterName, dispLevel, loadEndplayMap, loadSongs, loadSubsIndex, useAsync, formatClock } from "../data";
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

// Difficulties 枚举顺序（dump.cs）：0 Easy / 1 Hard / 2 Chaos / 3 Glitch / 4 Crash / 5 Dream / 6 Drop
const DIFF_KEYS = ["Easy", "Hard", "Chaos", "Glitch", "Crash", "Dream", "Drop"] as const;
const DIFF_LABEL = ["简单", "困难", "混沌", "Glitch", "Crash", "Dream", "Drop"] as const;

/** 歌曲目录（song_pack_data）+ 获取方式（iM 帖 / 分支节点） */
function SongSection({
  index,
  lang,
  onNavigate,
}: {
  index: import("../types").IndexData;
  lang: import("../types").Lang;
  onNavigate: (view: string, id?: string) => void;
}) {
  const songs = useAsync(loadSongs, []);
  if (songs.state === "loading") return <Skeleton rows={8} />;
  if (songs.state === "error") return <p className="state">歌曲目录加载失败。</p>;
  const catalog: SongCatalog = songs.data;

  const total = catalog.packs.reduce((n, p) => n + p.songs.length, 0) + catalog.other.length;
  const capsoIndex = new Map<string, { pack: import("../types").CapsoPack; diffs: number[] }>();
  for (const pack of catalog.capso) {
    for (const item of pack.songs) capsoIndex.set(item.id, { pack, diffs: item.diffs });
  }
  const gachaIndex = catalog.gacha.charts;
  const capsoLabel = (entry: { pack: import("../types").CapsoPack }) =>
    `CAPSO 商店「${entry.pack.name}」· ${entry.pack.price}${entry.pack.capsoPrice ? ` / ${entry.pack.capsoPrice} CAPSO` : ""}`;

  return (
    <div className="reader-inner">
      <div className="crumbs">
        <button type="button" className="chip chip-btn" onClick={() => onNavigate("extras")}>
          附录
        </button>
      </div>
      <h2>歌曲与获取方式</h2>
      <p className="lede">
        {catalog.packs.length} 个曲包 / {total} 首歌。曲名与难度来自 sharedassets0 的{" "}
        <span className="mono">song_pack_data</span>，每个难度带 <span className="mono">NeedUnlock</span>
        ：false = 拥有曲包即解锁（「默认解锁」），true = 需要一次解锁事件。获取方式按优先级判定：
        <b>iM 帖</b>（<span className="mono">UnlockCharts</span>）→
        <b>OS 档案</b>（<span className="mono">text/osdata/*</span> 的 <span className="mono">UnlockCharts</span>）→
        <b>OA 分析记录</b>（<span className="mono">oa_system_data</span> 的 <span className="mono">Rewards</span>）→
        <b>分支节点</b>（<span className="mono">UnlockedCharts</span>）→
        <b>通关剧情</b>（<span className="mono">storychartunlock</span>）→
        <b>默认解锁</b> → <b>CAPSO 商店</b>（<span className="mono">capsoshoppacks</span>）→
        <b>CAPSO! 抽奖</b>（<span className="mono">gacharewarddata.ab</span>）→ <b>购买曲包</b>（IAP）。
        都不匹配的写「需解锁 · 本地无记录」。等级一律按游戏内显示（数据里的 Level 是 0 基，这里 +1，
        exp 表长度 99 → 上限 Lv99）。
      </p>
      {catalog.packs.map((pack) => (
        <details key={pack.id} style={{ marginBottom: 10 }}>
          <summary className="mono">
            {pack.name}（{pack.id}）· {pack.songs.length} 首
            {pack.iap ? ` · 付费 ${pack.price ?? ""}` : " · 免费"}
            {pack.hasIM ? "" : " · 无 iM"}
          </summary>
          <table className="grid" style={{ marginTop: 6 }}>
            <tbody>
              {pack.songs.map((song) => (
                <tr key={song.id}>
                  <td style={{ width: 240 }}>
                    <b>{song.name}</b>
                    <div className="mono" style={{ color: "var(--muted)" }}>
                      {song.id} · {song.artist}
                    </div>
                  </td>
                  <td style={{ width: 120 }} className="mono">
                    {Object.entries(song.charts).map(([k, lv]) => `${k} ${lv}`).join(" / ")}
                  </td>
                  <td>
                    {DIFF_KEYS.map((key, d) => {
                      if (!(key in song.charts)) return null;
                      const hit = (catalog.unlocks[song.id] ?? []).find((u) => u.d === d);
                      const lvText = (hit?.levels ?? [])
                        .filter(([, lv]) => lv > 0)
                        .map(([pack2, lv]) => `${characterName(index, pack2)} Lv${dispLevel(lv)}`)
                        .join("、");
                      const osHit = (catalog.osCharts[song.id] ?? []).find((x) => x.d === d);
                      const oaHit = (catalog.oaCharts[song.id] ?? []).find((x) => x.d === d);
                      const notes = (catalog.notes[song.id] ?? []).filter((x) => x.d.includes(d));
                      const story = (catalog.storyCharts[song.id] ?? []).find((x) => x.d === d);
                      const capso = capsoIndex.get(song.id);
                      const gacha = (gachaIndex[song.id] ?? []).find((x) => x.d === d);
                      const free = !(song.needUnlock?.[key] ?? false);
                      return (
                        <div key={key} className="mono" style={{ lineHeight: 1.7 }}>
                          {DIFF_LABEL[d]}：
                          {hit ? (
                            <>
                              {lvText ? `${lvText} 后` : ""}阅读
                              {hit.src === "im" ? " iM 帖 " : " 分支节点 "}
                              <button
                                type="button"
                                className="chip chip-btn"
                                onClick={() => onNavigate(hit.src === "im" ? "im" : "branching", hit.ref)}
                              >
                                {hit.names?.[lang] || hit.names?.["zh-Hans"] || hit.ref}
                              </button>
                            </>
                          ) : osHit ? (
                            <>
                              {(osHit.levels ?? []).filter(([, lv]) => lv >= 0).map(([pack2, lv], i) => (
                                <span key={i}>{i ? "、" : ""}{characterName(index, pack2)} Lv{dispLevel(lv)} 后</span>
                              ))}
                              阅读 OS 档案{" "}
                              <button type="button" className="chip chip-btn" onClick={() => onNavigate("os", osHit.ref)}>
                                {osHit.names?.[lang] || osHit.names?.["zh-Hans"] || osHit.ref}
                              </button>
                            </>
                          ) : story ? (
                            <>
                              通关剧情{" "}
                              <button type="button" className="chip chip-btn" onClick={() => onNavigate("gates", story.story)}>
                                {story.story}
                              </button>
                            </>
                          ) : free ? (
                            <span style={{ color: "var(--muted)" }}>默认解锁（NeedUnlock=false）</span>
                          ) : oaHit ? (
                            <>
                              OA 分析记录{" "}
                              <button type="button" className="chip chip-btn" onClick={() => onNavigate("oa", oaHit.character)}>
                                {oaHit.names?.[lang] || oaHit.names?.["zh-Hans"] || oaHit.ref}
                              </button>
                              {oaHit.locks.length ? (
                                <span style={{ color: "var(--muted)" }}>
                                  （
                                  {oaHit.locks
                                    .map((l) =>
                                      l.kind === "OASystemLevelLock" && typeof l.level === "number"
                                        ? `${characterName(index, l.character)} Lv${dispLevel(l.level)}`
                                        : l.kind === "OASystemStoryLock"
                                          ? "需剧情"
                                          : l.kind === "OASystemOSLock"
                                            ? "需 OS 档案"
                                            : l.kind,
                                    )
                                    .join(" · ")}
                                  {oaHit.missions.length ? ` · ${oaHit.missions.length} 个任务` : ""}）
                                </span>
                              ) : null}
                            </>
                          ) : capso && capso.diffs.includes(d) ? (
                            <span>{capsoLabel(capso)}</span>
                          ) : gacha ? (
                            <span>
                              {gacha.machineName} 抽奖
                              {gacha.weight ? `（权重 ${gacha.weight}` : "（"}
                              {gacha.secret ? " · 隐藏" : ""}
                              {gacha.price ? ` · ${gacha.price}` : ""}）
                            </span>
                          ) : pack.iap ? (
                            <span style={{ color: "var(--muted)" }}>购买曲包后解锁</span>
                          ) : notes.length ? null : (
                            <span style={{ color: "var(--muted)" }}>需解锁 · 本地无记录</span>
                          )}
                          {notes.length ? (
                            <span style={{ color: "var(--muted)" }}>
                              {hit || osHit || oaHit || story || gacha ? " · " : ""}
                              {notes.length > 1 ? "外部资料（记载冲突）：" : "外部资料："}
                              {notes.map((n, i) => (
                                <span key={i}>
                                  {i ? "；" : ""}
                                  {n.text}
                                  {n.source ? `（${n.source}）` : ""}
                                  {n.story ? (
                                    <>
                                      {" "}
                                      <button type="button" className="chip chip-btn" onClick={() => onNavigate("gates", n.story!)}>
                                        {n.story}
                                      </button>
                                    </>
                                  ) : null}
                                </span>
                              ))}
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ))}

      <h3 style={{ marginTop: 18 }}>DLC / 扩展包（{catalog.expansion.length} 包 · {catalog.expansion.reduce((n, x) => n + x.songs.length, 0)} 首）</h3>
      <p className="lede">
        这些歌 <b>不在</b> <span className="mono">song_pack_data</span> 的离线曲库里，只出现在{" "}
        <span className="mono">expansion_pack_data</span>；购买对应 DLC 包即可游玩。
      </p>
      {catalog.expansion.map((pack) => (
        <details key={pack.id} style={{ marginBottom: 10 }}>
          <summary className="mono">
            {pack.name}（{pack.id}）· {pack.songs.length} 首 · {pack.price}
            {pack.boxOnly ? " · 仅礼盒" : ""}
            {pack.prePurchase ? " · 预购" : ""}
          </summary>
          <table className="grid" style={{ marginTop: 6 }}>
            <tbody>
              {pack.songs.map((song) => (
                <tr key={song.id}>
                  <td style={{ width: 240 }}>
                    <b>{song.name}</b>
                    <div className="mono" style={{ color: "var(--muted)" }}>
                      {song.id} · {song.artist}
                    </div>
                  </td>
                  <td style={{ width: 120 }} className="mono">
                    {Object.entries(song.charts).map(([k, lv]) => `${k} ${lv}`).join(" / ")}
                  </td>
                  <td className="mono" style={{ color: "var(--muted)" }}>
                    购买 DLC「{pack.name}」{pack.price}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ))}

      <h3 style={{ marginTop: 18 }}>CAPSO 商店与抽奖机</h3>
      <p className="lede">
        曲目以 <span className="mono">{`songId_难度`}</span> 形式挂在 CAPSO 包里，可用 CAPSO 点数或 IAP 购买。
        抽奖机配置在 <span className="mono">gacharewarddata.ab</span>（split_assets_pack_1）：
        <b>{catalog.gacha.machines.map((m) => `${m.Name}（${m.DefaultPrice}）`).join("、")}</b>
        ，共 {Object.values(catalog.gacha.charts).reduce((n, v) => n + v.length, 0)} 个抽奖限定谱面。
      </p>
      <table className="grid">
        <tbody>
          {catalog.capso.map((pack) => (
            <tr key={pack.id}>
              <td style={{ width: 260 }}>
                <b>{pack.name}</b>
                <div className="mono" style={{ color: "var(--muted)" }}>
                  {pack.id}
                </div>
              </td>
              <td style={{ width: 160 }} className="mono">
                {pack.price || "—"}
                {pack.capsoPrice ? ` / ${pack.capsoPrice} CAPSO` : ""}
              </td>
              <td className="mono">
                {pack.songs.map((x) => `${x.id}（${x.diffs.join(",")}）`).join("、") || "—"}
                {pack.extras.length ? ` · 其他：${pack.extras.join("、")}` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ExtrasReader({
  index,
  section,
  extra,
  loading,
  lang,
  onNavigate,
}: {
  index: IndexData;
  section: string;
  extra?: ExtraContent;
  loading: boolean;
  lang: Lang;
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
  if (section === "songs") {
    return <SongSection index={index} lang={lang} onNavigate={onNavigate} />;
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
