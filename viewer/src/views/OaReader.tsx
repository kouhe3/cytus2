import { useEffect, useState } from "react";
import type { ExtraContent, IndexData, OaItem } from "../types";
import { characterName } from "../data";
import { Script } from "../components/Script";
import { Video } from "../components/Media";
import { MEDIA_BASE, useManifest } from "../media";
import { Chip, Skeleton } from "../components/ui";

/** "descriptions" 或某个物件 id：每个物件一个页签，文件全挂在物件下 */
type OaTab = string;
const DESCRIPTIONS_TAB = "descriptions";

function Description({ id, item }: { id: string; item: OaItem }) {
  const conditions = [
    ...(item.enable ?? []).map((c) => `需要 ${c}`),
    ...(item.disable ?? []).map((c) => `之后替换 ${c}`),
  ];
  return (
    <div className="oa-desc">
      <p className="mono">
        {id}
        {item.name ? ` · ${item.name}` : ""}
        {item.event !== undefined ? ` · event ${item.event}` : ""}
      </p>
      {conditions.length > 0 ? (
        <p className="mono" style={{ color: "var(--muted)" }}>
          {conditions.join(" · ")}
        </p>
      ) : null}
      <p className="nar">{item.text}</p>
    </div>
  );
}

function Document({ id, item, lang }: { id: string; item: OaItem; lang?: string }) {
  return (
    <div className="oa-doc">
      <h4>{item.name || id}</h4>
      <p className="mono">
        {id}
        {item.object ? ` · 物件 ${item.object}` : ""}
      </p>
      {item.blocks ? <Script blocks={item.blocks} lang={lang} /> : null}
    </div>
  );
}

export function OaReader({
  index,
  lang,
  character,
  extra,
  loading,
  onNavigate,
}: {
  index: IndexData;
  lang?: string;
  character: string;
  extra?: ExtraContent;
  loading: boolean;
  onNavigate: (view: string, id?: string) => void;
}) {
  const chars = index.oa.find((c) => c.character === character);
  const manifest = useManifest();
  const sceneClips = Object.entries(manifest?.videos ?? {})
    .filter(([k]) => k.endsWith("_oa_system"))
    .map(([k, v]) => ({ key: k, char: k.slice(0, -"_oa_system".length), entry: v }));

  // 页签 = 描述 + 场景 + 每个物件；默认停在「描述」
  const [tab, setTab] = useState<OaTab>(DESCRIPTIONS_TAB);
  /** 二级页签：描述里选点位，物件里选文件；空串 = 全部 */
  const [sub, setSub] = useState("");
  useEffect(() => {
    setTab(DESCRIPTIONS_TAB);
    setSub("");
  }, [character]);
  if (!chars) return <p className="state">未找到 OA 角色 {character}。</p>;
  const item = (id: string) => extra?.oa[id];

  const descriptionsByObject = new Map<string, string[]>();
  for (const id of chars.descriptions) {
    const d = item(id);
    const parent = d?.object ?? "";
    if (!parent || !chars.objects.includes(parent)) continue;
    if (!descriptionsByObject.has(parent)) descriptionsByObject.set(parent, []);
    descriptionsByObject.get(parent)!.push(id);
  }
  const documentsByObject = new Map<string, string[]>();
  for (const id of chars.documents) {
    const d = item(id);
    const parent = d?.object ?? "";
    if (!parent) continue;
    if (!documentsByObject.has(parent)) documentsByObject.set(parent, []);
    documentsByObject.get(parent)!.push(id);
  }

  // 描述按 DescriptionObjectId 分组：同一热点的多个阶段变体
  const descGroupMap = new Map<string, string[]>();
  for (const id of chars.descriptions) {
    const g = item(id)?.group || id;
    if (!descGroupMap.has(g)) descGroupMap.set(g, []);
    descGroupMap.get(g)!.push(id);
  }
  const descriptionGroups = [...descGroupMap.entries()];

  const charScenes = sceneClips.filter(
    (c) => c.char === character || c.char.startsWith(`${character}_s`),
  );
  const tabs: { id: OaTab; label: string; n: number }[] = [
    { id: DESCRIPTIONS_TAB, label: "描述", n: descriptionGroups.length },
    ...(charScenes.length
      ? [{ id: "scenes", label: "场景", n: charScenes.length } as { id: OaTab; label: string; n: number }]
      : []),
    ...chars.objects.map((id) => ({
      id,
      label: item(id)?.name || id,
      n: (documentsByObject.get(id) ?? []).length,
    })),
  ];
  const activeObject = chars.objects.includes(tab) ? tab : undefined;
  const activeScenes = tab === "scenes" ? charScenes : [];
  const objectDocs = activeObject ? documentsByObject.get(activeObject) ?? [] : [];
  const subTabs: { id: string; label: string }[] =
    tab === "scenes"
      ? []
      : activeObject === undefined
      ? [
          { id: "", label: "全部" },
          ...descriptionGroups.map(([group, ids]) => ({
            id: group,
            label: item(ids[0])?.name?.split("\n").pop() || group,
          })),
        ]
      : [
          { id: "", label: "全部" },
          ...objectDocs.map((did) => ({ id: did, label: item(did)?.name || did })),
        ];

  return (
    <div className="reader-inner">
      <div className="crumbs">
        <button type="button" className="chip chip-btn" onClick={() => onNavigate("oa")}>
          OA System
        </button>{" "}
        <Chip>
          {chars.objects.length} 物件 · {chars.descriptions.length} 描述 · {chars.documents.length} 文件
        </Chip>
      </div>
      <h2>{characterName(index, character)}</h2>
      <p className="lede">
        角色 <span className="mono">{character}</span> · 探索式档案：物件 → 文件，另有场景热点「描述」。联动章节用它替代
        OS 档案层。
      </p>
      {loading ? <Skeleton rows={8} /> : null}

      <div className="lang" role="group" aria-label="OA 子分类">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={t.id === tab}
            onClick={() => {
              setTab(t.id);
              setSub("");
            }}
          >
            {t.n ? `${t.label} ${t.n}` : t.label}
          </button>
        ))}
      </div>

      {subTabs.length > 2 ? (
        <div className="lang" role="group" aria-label="OA 二级分类">
          {subTabs.map((t) => (
            <button
              key={t.id || "all"}
              type="button"
              aria-pressed={t.id === sub}
              onClick={() => setSub(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      ) : null}

      {activeScenes.length > 0 ? (
        <>
          <p className="lede">
            OA 探索场景（1136×852 的循环动画，舞台面板本身留白）；游戏里会把角色 / 物件 LOGO 合成到
            场景面板上，这里把 LOGO 原图一并列出，可按需叠加。
          </p>
          <div className="oa-art">
            {[character, `${character.slice(0, -3)}002`, `${character.slice(0, -3)}003`]
              .map((id) => ({ id, hit: manifest?.oaAssets?.[`${id}_l`] }))
              .filter((x) => x.hit)
              .map(({ id, hit }) => (
                <figure className="oa-art-item" key={id}>
                  <img src={MEDIA_BASE + encodeURI(hit!.file)} alt={`${id} logo`} loading="lazy" />
                  <figcaption className="mono">
                    {id}_l · {characterName(index, id)} 的 LOGO
                  </figcaption>
                </figure>
              ))}
          </div>
          {activeScenes.map(({ key, char, entry }) => {
            const costumeId = char.includes("_s") ? char : "";
            const costume = costumeId
              ? index.illustrations.find((i) => i.id === costumeId)?.costume
              : "";
            return (
              <Video
                key={key}
                entry={entry}
                id={costume ? `${key} · ${costume}` : key}
                lang={lang}
              />
            );
          })}
        </>
      ) : activeObject === undefined ? (
        <>
          <p className="lede">
            「描述」是 OA 场景里的可点击热点（如「上方紅色面板」），游戏里不归属任何物件；文件全部归属于某个物件，
            见对应物件的页签。
          </p>
          {descriptionGroups
            .filter(([group]) => !sub || group === sub)
            .map(([group, ids]) => (
            <section key={group} className="oa-desc-group">
              <h3>
                {item(ids[0])?.name || group}
                <span className="mono">
                  {group} · {ids.length} 个变体
                </span>
              </h3>
              {ids.map((id) => {
                const d = item(id);
                return d ? <Description key={id} id={id} item={d} /> : null;
              })}
            </section>
          ))}
        </>
      ) : (
        (() => {
          const o = item(activeObject);
          const docs = objectDocs.filter((did) => !sub || did === sub);
          return (
            <section className="oa-object">
              <h3>
                {o?.name || activeObject} <span className="mono">{activeObject}</span>
              </h3>
              {o?.details ? <p className="nar">{o.details}</p> : null}
              <div className="oa-art">
                {(() => {
                  const idx = activeObject.split("obj")[1] ?? "";
                  const objImg = manifest?.oaAssets?.[`${character}_obj${idx}`];
                  const panels = [1, 2, 3]
                    .map((n) => ({ n, hit: manifest?.oaAssets?.[`oas_${character}_${idx}_${n}`] }))
                    .filter((p) => p.hit);
                  return (
                    <>
                      {objImg ? (
                        <figure className="oa-art-item">
                          <img src={MEDIA_BASE + encodeURI(objImg.file)} alt={activeObject} loading="lazy" />
                          <figcaption className="mono">物件图 {objImg.w}×{objImg.h}</figcaption>
                        </figure>
                      ) : null}
                      {panels.map(({ n, hit }) => (
                        <figure className="oa-art-item" key={n}>
                          <img
                            src={MEDIA_BASE + encodeURI(hit!.file)}
                            alt={`${activeObject} 面板 ${n}`}
                            loading="lazy"
                          />
                          <figcaption className="mono">
                            oas_{character}_{idx}_{n} · {hit!.w}×{hit!.h}
                          </figcaption>
                        </figure>
                      ))}
                    </>
                  );
                })()}
              </div>
              {docs.length === 0 ? <p className="mono">该物件没有关联文件。</p> : null}
              {docs.map((did) => {
                const d = item(did);
                return d ? <Document key={did} id={did} item={d} lang={lang} /> : null;
              })}
            </section>
          );
        })()
      )}
    </div>
  );
}
