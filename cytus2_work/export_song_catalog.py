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

另外两件事决定「默认解锁」与「通关解锁」：
  * `song_pack_data` 的每个难度带 `NeedUnlock`：false = 拥有曲包即解锁（默认解锁），true = 需要额外解锁
  * `chartunlock.ab` 的 TextAsset `storychartunlock`：{storyId: [{SongId, Difficulty}]}，通关该剧情时解锁
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


def read_bundle_textasset(bundle: str, name: str):
    """从 bundle 里取指定 TextAsset 的 JSON"""
    import UnityPy

    env = UnityPy.load(os.path.join(TMP, bundle))
    for obj in env.objects:
        if obj.type.name != "TextAsset":
            continue
        ta = obj.read()
        if ta.m_Name != name:
            continue
        raw = ta.m_Script
        return json.loads(raw if isinstance(raw, str) else bytes(raw).decode("utf-8", "replace"))
    return None


def read_expansion() -> list:
    """expansion_pack_data（DLC）→ 曲包列表；这些歌不在 song_pack_data 的 offline 列表里"""
    data = read_bundle_textasset("sharedassets0.assets", "expansion_pack_data") or {}
    out = []
    for p in data.get("ExpansionPackList") or []:
        out.append({
            "id": p["ExpansionPackId"],
            "name": (p.get("ExpansionPackName") or "").replace("\n", " ").strip(),
            "price": p.get("DefaultPrice") or "",
            "boxOnly": bool(p.get("IsBoxOnly")),
            "prePurchase": bool(p.get("IsPrePurchase")),
            "songs": [
                {
                    "id": s["SongId"],
                    "name": s.get("SongName"),
                    "artist": s.get("Artist"),
                    "packId": s.get("SongPackId") or "",
                    "charts": {k: v.get("Level") for k, v in (s.get("Charts") or {}).items()},
                    "needUnlock": {k: bool(v.get("NeedUnlock")) for k, v in (s.get("Charts") or {}).items()},
                }
                for s in p.get("SongInfoList") or []
            ],
        })
    return out


def read_capso() -> list:
    """capsoshoppacks → CAPSO 商店包；歌曲条目形如 `neko001_058_0,1,2`（下划线后是难度）"""
    packs = read_bundle_textasset("capsoshopdata.ab", "capsoshoppacks") or []
    out = []
    for p in packs:
        songs, extras = [], []
        for it in p.get("Items") or []:
            if it.get("ItemType") == 0:
                parts = it["Id"].rsplit("_", 1)
                diffs = [int(x) for x in parts[1].split(",") if x.isdigit()] if len(parts) == 2 else []
                songs.append({"id": parts[0], "diffs": diffs})
            else:
                extras.append(it["Id"])
        out.append({
            "id": p["Id"],
            "name": (p.get("Name") or "").replace("\n", " ").strip(),
            "price": p.get("DefaultPriceString") or "",
            "capsoPrice": p.get("CapsoPrice") or 0,
            "iap": bool(p.get("IsAvailableForIAP")),
            "capso": bool(p.get("IsAvailableForCapso")),
            "songs": songs,
            "extras": extras,
        })
    return out


def read_gacha() -> dict:
    """gacharewarddata.ab（split_assets_pack_1）→ CAPSO! 抽奖机奖励

    gachareward: [{Id, Type, Gacha Machine ID, Weight, IsSecret, RewardLocks}]
      Type 0=Chart 1=Skin 2=TapFX 3=Gallery；Chart 的 Id 形如 `robo001_001_3` / `neko001_005_0,1`
    gachamachines: [{ID, Name, DefaultPrice}]（本地只有 `capso` = The CAPSO!）
    """
    dst = os.path.join(TMP, "gacharewarddata.ab")
    if not os.path.exists(dst):
        with zipfile.ZipFile(os.path.join(HERE, "..", "split_assets_pack_1.apk")) as z:
            members = [n for n in z.namelist() if n.endswith("gacharewarddata.ab")]
            if not members:
                return {"machines": [], "charts": {}, "others": []}
            with open(dst, "wb") as fh:
                fh.write(z.read(members[0]))

    import UnityPy

    env = UnityPy.load(dst)
    rewards, machines = [], []
    for obj in env.objects:
        if obj.type.name != "TextAsset":
            continue
        ta = obj.read()
        if ta.m_Name not in ("gachareward", "gachamachines"):
            continue
        raw = ta.m_Script
        parsed = json.loads(raw if isinstance(raw, str) else bytes(raw).decode("utf-8", "replace"))
        if ta.m_Name == "gachareward":
            rewards = parsed
        else:
            machines = parsed

    by_id = {m["ID"]: m for m in machines}
    charts, others = {}, []
    for r in rewards:
        machine = by_id.get(r.get("Gacha Machine ID") or "", {})
        entry = {
            "machine": r.get("Gacha Machine ID") or "",
            "machineName": machine.get("Name") or r.get("Gacha Machine ID") or "",
            "price": machine.get("DefaultPrice") or "",
            "weight": r.get("Weight"),
            "secret": bool(r.get("IsSecret")),
        }
        if r.get("Type") == 0:
            parts = r["Id"].rsplit("_", 1)
            diffs = [int(x) for x in parts[1].split(",") if x.isdigit()] if len(parts) == 2 else []
            for d in diffs:
                charts.setdefault(parts[0], []).append({"d": d, **entry})
        else:
            others.append({"id": r["Id"], "type": r.get("Type"), **entry})
    return {"machines": machines, "charts": charts, "others": others}


def read_story_chart_unlock() -> dict:
    """chartunlock.ab → {songId: [{d, story}]}（storychartunlock）"""
    import UnityPy

    env = UnityPy.load(os.path.join(TMP, "chartunlock.ab"))
    out = {}
    for obj in env.objects:
        if obj.type.name != "TextAsset":
            continue
        ta = obj.read()
        if ta.m_Name != "storychartunlock":
            continue
        raw = ta.m_Script
        for story, charts in json.loads(raw if isinstance(raw, str) else bytes(raw).decode("utf-8")).items():
            for c in charts:
                out.setdefault(c["SongId"], []).append({"d": c.get("Difficulty"), "story": story})
    return out


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
                    # false = 拥有曲包即解锁；true = 需要额外解锁
                    "needUnlock": {
                        k: bool(v.get("NeedUnlock")) for k, v in (s.get("charts") or {}).items()
                    },
                }
                for s in p.get("song_info_list") or []
            ],
        })
    other = [
        {"id": s["song_id"], "name": s.get("song_name"), "artist": s.get("artist"),
         "charts": {k: v.get("Level") for k, v in (s.get("charts") or {}).items()},
         "needUnlock": {k: bool(v.get("NeedUnlock")) for k, v in (s.get("charts") or {}).items()}}
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

    data = {
        "packs": packs,
        "other": other,
        "unlocks": unlocks,
        "storyCharts": read_story_chart_unlock(),
        "expansion": read_expansion(),
        "capso": read_capso(),
        "gacha": read_gacha(),
    }
    json.dump(data, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    songs = sum(len(p["songs"]) for p in packs) + len(other)
    n_story = len(data["storyCharts"])
    n_dlc = sum(len(x["songs"]) for x in data["expansion"])
    n_capso = sum(len(x["songs"]) for x in data["capso"])
    n_gacha = sum(len(v) for v in data["gacha"]["charts"].values())
    print(
        f"{len(packs)} 个曲包 / {songs} 首歌（另有 DLC {len(data['expansion'])} 包 {n_dlc} 首、"
        f"CAPSO {len(data['capso'])} 包 {n_capso} 首）/ {len(unlocks)} 首有帖子或节点获取方式 / "
        f"{n_story} 首有通关解锁 / CAPSO! 抽奖 {n_gacha} 个谱面 → {os.path.relpath(OUT, HERE)}"
    )


if __name__ == "__main__":
    main()
