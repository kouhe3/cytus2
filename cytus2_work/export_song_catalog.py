#!/usr/bin/env python3
"""歌曲目录 + 获取方式 → viewer/public/data/songs.json

歌曲目录来自 `split_base_assets.apk` 的 `assets/bin/Data/sharedassets0.assets`（分片 .splitN），
里面的 TextAsset `song_pack_data` 就是游戏内曲库：

    {"offline_song_pack_list":[{"song_pack_id","song_pack_name","is_iap_pack","hasIM","Category",
                                "song_info_list":[{"song_id","song_name","artist",
                                                   "charts":{"Easy":{"Level":"6"},...}}]}]}

获取方式来自两处（都带 Difficulty，0=Easy 1=Hard 2=Chaos）：
  * `imdata/im_topic_data` → UnlockCharts：帖子 + 该帖的等级锁 / 剧情锁
  * `branchingosdata/tairitsu001` → UnlockedCharts：分支节点 + UnlockCondition.Level
"""
import json, os, subprocess, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
APK = os.path.join(HERE, "..", "split_base_assets.apk")
TMP = os.path.join(HERE, "media_bundles")
OUT = os.path.join(HERE, "..", "viewer", "public", "data", "songs.json")
T = os.path.join(HERE, "text")


def assemble_shared0() -> str:
    """sharedassets0.assets 被切成 .splitN，按序拼回"""
    dst = os.path.join(TMP, "sharedassets0.assets")
    if os.path.exists(dst):
        return dst
    os.makedirs(TMP, exist_ok=True)
    z = zipfile.ZipFile(APK)
    parts = sorted(
        (i for i in z.infolist() if i.filename.startswith("assets/bin/Data/sharedassets0.assets")),
        key=lambda i: i.filename,
    )
    with open(dst, "wb") as fh:
        for p in parts:
            fh.write(z.read(p))
    return dst


def main():
    import UnityPy

    env = UnityPy.load(assemble_shared0())
    catalog = None
    for obj in env.objects:
        if obj.type.name != "TextAsset":
            continue
        ta = obj.read()
        if ta.m_Name != "song_pack_data":
            continue
        raw = ta.m_Script
        catalog = json.loads(raw if isinstance(raw, str) else bytes(raw).decode("utf-8", "replace"))
        break
    if catalog is None:
        raise SystemExit("sharedassets0 里没有 song_pack_data")

    packs = []
    for p in catalog.get("offline_song_pack_list") or []:
        packs.append({
            "id": p["song_pack_id"],
            "name": p.get("song_pack_name"),
            "iap": bool(p.get("is_iap_pack")),
            "hasIM": bool(p.get("hasIM")),
            "category": p.get("Category") or "",
            "price": p.get("price") or "",
            "songs": [
                {
                    "id": s["song_id"],
                    "name": s.get("song_name"),
                    "artist": s.get("artist"),
                    "charts": {k: v.get("Level") for k, v in (s.get("charts") or {}).items()},
                }
                for s in p.get("song_info_list") or []
            ],
        })
    other = [
        {"id": s["song_id"], "name": s.get("song_name"), "artist": s.get("artist"),
         "charts": {k: v.get("Level") for k, v in (s.get("charts") or {}).items()}}
        for s in catalog.get("other_song_info_list") or []
    ]

    # Titles/Names 的 6 槽位 → 语言码（与 LANGS 一致：0 en / 1 ja / 2 zh-Hant / 3 ko / 5 zh-Hans）
    SLOT = {"en": 0, "ja": 1, "zh-Hant": 2, "ko": 3, "zh-Hans": 5}

    def names_by_lang(arr):
        return {code: (arr or [""] * 6)[i] for code, i in SLOT.items()}

    # ---- 获取方式：iM 帖 / 分支节点 ----
    unlocks = {}
    topics = json.load(open(os.path.join(T, "imdata", "im_topic_data"), encoding="utf-8"))
    lock = {e["TopicId"]: e for e in json.load(open(os.path.join(T, "imdata", "im_lock_condition_data"), encoding="utf-8"))}
    for t in topics:
        charts = t.get("UnlockCharts") or []
        if not charts:
            continue
        lk = lock.get(t["Id"]) or {}
        for c in charts:
            unlocks.setdefault(c["SongId"], []).append({
                "d": c.get("Difficulty"),
                "src": "im",
                "ref": t["Id"],
                "names": names_by_lang(t.get("Titles")),
                "levels": [[x["SongPackId"], x["Level"]] for x in lk.get("LevelLocks") or []],
                "story": lk.get("StoryLockId") or "",
            })
    br = json.load(open(os.path.join(T, "branchingosdata", "tairitsu001"), encoding="utf-8"))
    for n in br:
        charts = n.get("UnlockedCharts") or []
        if not charts:
            continue
        uc = n.get("UnlockCondition") or {}
        for c in charts:
            unlocks.setdefault(c["SongId"], []).append({
                "d": c.get("Difficulty"),
                "src": "branch",
                "ref": n["Id"],
                "names": names_by_lang(n.get("Names")),
                "levels": [["tairitsu001", uc.get("Level") or 0]],
                "story": "",
            })

    data = {"packs": packs, "other": other, "unlocks": unlocks}
    json.dump(data, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    songs = sum(len(p["songs"]) for p in packs) + len(other)
    print(f"{len(packs)} 个曲包 / {songs} 首歌 / {len(unlocks)} 首有获取方式 → {os.path.relpath(OUT, HERE)}")


if __name__ == "__main__":
    main()
