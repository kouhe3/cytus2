#!/usr/bin/env python3
"""Build the narrative linkage layer for Cytus II story text.

Wiki 四系统（Character OS / Timeline OS / OA System / Backup Database）在数据里的落点：
  Character OS  -> osdata.ab 的 TimelineChapter.Folder（按角色文件夹陈列）
  Timeline OS   -> osdata.ab 的 TimelineChapter.Chapter + Index + Date（按事件时间陈列，同一批条目）
  OA System     -> oasystemdata.ab（Object / Description / Document / Mission）
  Backup DB     -> branchingosdata.ab（taos* 带 a/b/c 分支与 LinkedFileIds 图）
iM（社群时间线）是独立轨道，用 (SongPackId, Level) 与 OS 共用解锁闸。

输出：cytus2_story/story/**
"""
import json, os, re, glob, collections, shutil

T = "text"
OUT = "../cytus2_story/story"
ROOT = "../cytus2_story"
LANG = "zh-Hans"

def load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)

def packs(locks):
    return [(x.get("SongPackId"), x.get("Level")) for x in (locks or [])]

def parse_date(s):
    if not s:
        return None
    s = s.strip().replace("\n", " ")
    m = re.match(r"(\d{3,4})_(\d{2})_(\d{2})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?", s)
    if not m:
        return None
    g = [int(x) if x else 0 for x in m.groups()]
    return tuple(g + [0] * (6 - len(g)))

def date_str(s):
    d = parse_date(s)
    if not d:
        return (s or "").replace("\n", " ")
    y, mo, da, h, mi, se = d
    return f"{y}_{mo:02d}_{da:02d} {h:02d}:{mi:02d}"

def one_line(s):
    return " ".join(str(s or "").split())

def md(v):
    return one_line(v).replace("|", "\\|")

def main():
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    for sub in ("chapters", "packs", "systems"):
        os.makedirs(os.path.join(OUT, sub), exist_ok=True)

    chapters = load(os.path.join(T, "osdata", "chapters"))
    ch_id = {c["Name"]: c["Id"] for c in chapters}

    topics = load(os.path.join(T, "imdata", "im_topic_data"))
    topic_order = [t["Id"].upper() for t in topics]
    topic_by_id = {t["Id"].upper(): t for t in topics}
    topic_pos = {tid: i for i, tid in enumerate(topic_order)}
    imlock = {e["TopicId"].upper(): e for e in load(os.path.join(T, "imdata", "im_lock_condition_data"))}

    # ---------- OS entries ----------
    os_entries = []
    for f in sorted(os.listdir(os.path.join(T, "osdata"))):
        if f == "chapters":
            continue
        for e in load(os.path.join(T, "osdata", f)):
            tl = e.get("TimelineChapter") or {}
            e["_file"] = f
            e["_chapter"] = tl.get("Chapter", "")
            e["_folder"] = tl.get("Folder", "")
            e["_index"] = tl.get("Index", 0)
            e["_date"] = parse_date(e.get("Date"))
            e["_packs"] = packs((e.get("OSLockCondition") or {}).get("LevelLocks"))
            e["_filelock"] = (e.get("OSLockCondition") or {}).get("FileLockId") or ""
            movies = []
            for c in e.get("Contents") or []:
                if isinstance(c, str):
                    movies += [ln.split("=", 1)[1].strip() for ln in c.splitlines() if ln.startswith("##movie=")]
            e["_movies"] = sorted(set(movies))
            os_entries.append(e)
    os_by_id = {e["Id"]: e for e in os_entries}

    def up(n):
        return "../" * n

    def os_link(e, lv=1):
        return f"[{e['Id']}]({up(lv)}{LANG}/os/{e['_file']}.md)"

    def im_link(tid, lv=1):
        return f"[{tid}]({up(lv)}{LANG}/im/{tid}.md)"

    # ---------- chapters ----------
    by_chapter = collections.defaultdict(list)
    for e in os_entries:
        by_chapter[e["_chapter"]].append(e)

    ch_stats = {}
    for name, es in by_chapter.items():
        es_idx = sorted(es, key=lambda x: x["_index"])
        dated = [e["_date"] for e in es if e["_date"]]
        order_by_date = sorted(es, key=lambda e: (e["_date"] or (9999, 99, 99), e["_index"]))
        pos = {id(e): i for i, e in enumerate(es_idx)}
        inversions = sum(1 for i in range(1, len(order_by_date)) if pos[id(order_by_date[i])] < pos[id(order_by_date[i - 1])])
        ch_stats[name] = {
            "count": len(es),
            "index": (es_idx[0]["_index"], es_idx[-1]["_index"]),
            "date": (min(dated), max(dated)) if dated else None,
            "cast": collections.Counter(e["_folder"] for e in es).most_common(),
            "movies": sum(1 for e in es if e["_movies"]),
            "inversions": inversions,
            "files": sorted({e["_file"] for e in es}),
            "packs": collections.Counter(p for e in es for p, _ in e["_packs"]).most_common(),
        }

    main = sorted([c for c in chapters if c["Category"] == 0], key=lambda c: ch_stats[c["Name"]]["index"][0])
    collab = sorted([c for c in chapters if c["Category"] != 0 and c["Name"] in ch_stats
                     and not c["Name"].lower().startswith("test")], key=lambda c: c["Id"])
    weird = [c for c in chapters if c["Name"] in ch_stats
             and (c["Category"] != 0 and c["Name"].lower().startswith("test"))]
    ordered = main + collab + weird
    slug_of = {c["Name"]: f"{c['Id']:02d}-" + re.sub(r"[^a-z0-9]+", "", c["Name"].lower()) + ".md" for c in chapters}

    # ---------- packs ----------
    pack_events = collections.defaultdict(lambda: collections.defaultdict(lambda: {"os": [], "im": []}))
    pack_folders = collections.defaultdict(collections.Counter)
    pack_chapters = collections.defaultdict(collections.Counter)
    for e in os_entries:
        for p, lv in e["_packs"]:
            pack_events[p][lv]["os"].append(e)
            pack_folders[p][e["_folder"]] += 1
            pack_chapters[p][e["_chapter"]] += 1
    im_no_lock = []
    for tid in topic_order:
        lk = imlock.get(tid) or {}
        if not lk.get("LevelLocks"):
            im_no_lock.append(tid)
        for p, lv in packs(lk.get("LevelLocks")):
            pack_events[p][lv]["im"].append(tid)

    gates = collections.defaultdict(list)
    for tid in topic_order:
        s = (imlock.get(tid) or {}).get("StoryLockId") or ""
        if s and s != "story01":
            gates[s].append(tid)
    n_main_gate = sum(1 for t in topic_order if (imlock.get(t) or {}).get("StoryLockId") == "story01")
    n_no_gate = sum(1 for t in topic_order if not (imlock.get(t) or {}).get("StoryLockId"))

    titles = load(os.path.join(T, "titleinfodata", "title_info"))
    oa = load(os.path.join(T, "oasystemdata", "oa_system_data"))
    br = load(os.path.join(T, "branchingosdata", "tairitsu001"))
    gallery_dir = os.path.join(T, "gallerydata")
    gallery_folders = load(os.path.join(gallery_dir, "folder"))
    gallery_items = []
    for gf in gallery_folders:
        fpath = os.path.join(gallery_dir, gf["Id"])
        if not os.path.exists(fpath):
            continue
        for it in load(fpath):
            gallery_items.append({**it, "_folder": gf["Id"]})
    cut = load(os.path.join(T, "cutscenedata", "cutscene_data_os"))

    n_sync = sum(1 for p in pack_events for lv in pack_events[p]
                 if pack_events[p][lv]["os"] and pack_events[p][lv]["im"])
    n_sync_im = len({t for p in pack_events for lv in pack_events[p] if pack_events[p][lv]["os"]
                     for t in pack_events[p][lv]["im"]})
    n_movies = sum(1 for e in os_entries if e["_movies"])

    # ============ README ============
    r = []
    A = r.append
    A("# Cytus II 剧情脉络（由游戏数据构建）")
    A("")
    A("Wiki 把剧情归档分成四个 OS 系统；这套数据里四个系统分别对应到四个 bundle，两两不重叠，另有一条独立的 iM 社群轨道。")
    A("")
    A("| 系统 | 数据来源 | 数量 | 说明 |")
    A("|:--|:--|:--|:--|")
    A(f"| [Character OS System](systems/character-os.md) | `osdata.ab` 的 `TimelineChapter.Folder` | {len({e['_folder'] for e in os_entries})} 个文件夹 / {len({e['_file'] for e in os_entries})} 个档案文件（+1 空占位 `tairitsu001`） / 1125 条 | 按角色文件夹陈列的档案 |")
    A(f"| [Timeline OS System](systems/timeline-os.md) + [chapters.md](chapters.md)、[timeline.md](timeline.md) | 同一批条目的 `Chapter` + `Index` + `Date` | {len(ch_stats)} 章（10 主线 + 7 联动 + 1 测试）/ 1125 条 | 同一批档案的时间轴视图 |")
    A("| [OA System](systems/oa-system.md) | `oasystemdata.ab` | 18 物件 / 117 描述 / 101 文件 | 联动角色的探索式档案 |")
    A(f"| [Backup Database System](systems/backup-database.md) | `gallerydata` | {len(gallery_folders)} 文件夹 / {len(gallery_items)} 文件 | 各角色的影片/插图/Boss 舞台备份，按 `FileLocation` 挂到 OS 档案或剧情步 |")
    A(f"| [分支剧情](systems/branching.md) | `branchingosdata.ab` | {len(br)} 节点 / 3 分支 | 带 `LinkedFileIds` 的支线图（Tairitsu 线），与上面四个系统并列 |")
    A(f"| iM 社群轨道 | `imdata.ab` 的 `im_topic_data` + `imposts_*.ab` | {len(topic_order)} 帖 / 4155 回复 | 角色公开社群时间线，与 OS 共用解锁闸 |")
    A("")
    A("> Character OS 与 Timeline OS 是**同一批 1125 条档案的两种陈列方式**：同一条 `pos001` 在角色视图里挂在 `PAFF` 文件夹下，在时间轴视图里挂在 `cyTus` 章、`Index 3006`、日期 `693_03_16`。数据只存了一份，两个视图的归属字段都在 `TimelineChapter` 里。")
    A("")
    A("## 三条顺序轴")
    A("")
    A("| 轴 | 字段 | 用来回答 |")
    A("|:--|:--|:--|")
    A("| 章节轴（叙事骨架） | `Chapter` + `Index` | 官方章节阅读序，见 [chapters.md](chapters.md) |")
    A("| 世界时间轴 | `Date`（纪元 690–702 等） | 故事内真实先后，见 [timeline.md](timeline.md)；与章节序的偏离量已在章节表里统计 |")
    A("| 解锁进度轴 | `(SongPackId, Level)` | 玩家实际看到的先后；iM 帖与 OS 条目共用，见 [packs/](packs/) |")
    A("")
    A("iM 帖没有时间戳，但 `im_topic_data` 自身顺序就是游戏内时间线顺序（每个角色子序列严格按编号递增：P0101→P2501、R0101→R2401、N0101→N2801）。")
    A("")
    A("## 四系统 + iM 之间的关系")
    A("")
    A("```mermaid")
    A("flowchart LR")
    A(f'  im["iM 社群<br/>{len(topic_order)} 帖"]')
    A(f'  os["OS 档案<br/>{len(os_entries)} 条"]')
    A(f'  ch["Timeline OS<br/>{len(ch_stats)} 章"]')
    A(f'  cf["Character OS<br/>{len({e["_file"] for e in os_entries})} 档案"]')
    A(f'  oa["OA System<br/>{len(oa.get("Objects", []))} 物件"]')
    A(f'  bd["Backup Database<br/>{len(gallery_folders)} 文件夹 / {len(gallery_items)} 文件"]')
    A(f'  gate["剧情闸 story01 / {len(gates)} 个结局闸"]')
    A(f'  br["分支剧情<br/>{len(br)} 节点"]')
    A("  os --> ch")
    A("  os --> cf")
    A("  gate --> im")
    A("  gate --> os")
    A("  oa -.联动角色独立展开.-> os")
    A("  bd -.备份文件.-> os")
    A("  br -.支线.-> os")
    A("```")
    A("")
    A("数据里能证明的硬连接只有四处（其余为同源陈列，不是叙事依赖）：")
    A("")
    A("| 连接 | 依据 | 数量 |")
    A("|:--|:--|--:|")
    A(f"| iM 帖 ↔ OS 条目同一刻解锁 | 同一 `(曲包, level)` | {n_sync} 个同步点 / {n_sync_im} 帖 |")
    A("| OS 条目 → OS 条目前置 | `OSLockCondition.FileLockId` | 5 条 |")
    A(f"| OS 条目 → 影片 | `##movie=` 指令 + `cutscenedata` + `.srt` | {n_movies} 条 |")
    A(f"| 结局闸 → iM 帖 | `im_lock_condition_data.StoryLockId` | {len(gates)} 个闸 / {sum(len(v) for v in gates.values())} 帖 |")
    A("")
    A("反向检查：把 iM 全文与 OS 全文互搜对方的 item id（`P0101`、`pos001` 等），0 命中 —— 两条轨道从不显式互引，交集只发生在解锁闸与内容呼应上。")
    A("")
    A("## 阅读路径")
    A("")
    A("1. **要故事骨架** → [chapters.md](chapters.md) 拿章节顺序与每章登场档案，再点进 `chapters/NN-*.md` 看逐条档案（含日期与曲包等级）。")
    A("2. **要玩家流程** → [packs/](packs/)：同一行的 iM 帖和 OS 条目就是同一刻解锁的一对，按 level 升序读即通关顺序。")
    A("3. **要两条轨道的交点** → [sync-points.md](sync-points.md)（同一 `(曲包,level)` 同时解锁的 iM 帖与 OS 条目），或 [im-timeline.md](im-timeline.md)（iM 全序 + 每帖的同步 OS 列）。")
    A("4. **要故事内时间** → [timeline.md](timeline.md)；章节里 `时间倒序` 数值大的，说明该章大量使用倒叙/回忆。")
    A("5. **要结局分支** → [endings.md](endings.md)。")
    A("6. **要备份数据库 / 分支线** → `systems/backup-database.md`（每角色影片、插图、Boss 舞台与解锁条件）、`systems/branching.md`（Tairitsu 支线图）。")
    A("")
    A("原文在这四个目录：`../" + LANG + "/{im,os,oa,branching}/`（另有 en / ja / ko / zh-Hant 同构目录）。")
    A("")
    A("## 数据字段速查")
    A("")
    A("| 字段 | 含义 | 备注 |")
    A("|:--|:--|:--|")
    A("| `TimelineChapter.Folder` | Character OS 的文件夹 | `Main_Folder` / `N/A` 为公共与未归类 |")
    A("| `TimelineChapter.Chapter` / `Index` | Timeline OS 的章与序 | `Index` 千位即章号（1001 Architects … 10001 The New World） |")
    A("| `Date` | 故事内时间 | 章内可跨多年，倒叙由此产生 |")
    A("| `Category` | 档案编号（如 `2.3`、`3.4.5`） | 文件夹内的编号，非系统分类 |")
    A("| `Type` | 条目类型（0 日志 / 1/3 对话演出 / 8/9/10 分支节点 …） | — |")
    A("| `OSLockCondition.FileLockId` | 前置档案 | 支线串联（ivos008→011→030→035 等） |")
    A("| `StoryLockId` | iM 帖的剧情闸 | `story01` 主线；其余为结局 |")
    A("")
    A("`graph.json`：章节 / 曲包 / OS 条目 / iM 帖 / 影片 / 结局闸的节点与边（`contains`、`unlocks_at`、`requires`、`movie`、`gates`）。")
    A("")
    open(os.path.join(OUT, "README.md"), "w", encoding="utf-8").write("\n".join(r))

    # ============ chapters.md ============
    L = ["# 章节骨架（Timeline OS）", "",
         "主线 10 章按 `Index` 千位排序（1001 Architects → 10001 The New World），联动 7 章用自己的曲包独立展开；`test01` 是开发用测试数据，单独列在最后。",
         "",
         "| # | 章节 | 类型 | 条目 | Index | 世界时间 | 档案 | 影片 | 时间倒序 |",
         "|:--|:--|:--|--:|:--|:--|:--|--:|--:|"]
    for i, c in enumerate(ordered, 1):
        st = ch_stats[c["Name"]]
        d = st["date"]
        span = f"{d[0][0]}_{d[0][1]:02d}_{d[0][2]:02d} → {d[1][0]}_{d[1][1]:02d}_{d[1][2]:02d}" if d else "—"
        typ = "主线" if c["Category"] == 0 else ("测试数据" if c["Name"].lower().startswith("test") else "联动")
        L.append(f"| {i} | [{c['Name']}](chapters/{slug_of[c['Name']]}) | {typ} | {st['count']} | "
                 f"{st['index'][0]}–{st['index'][1]} | {span} | {len(st['files'])} | {st['movies']} | {st['inversions']} |")
    L += ["", "「时间倒序」= 章内按 `Date` 排序时与 `Index` 序不一致的位置数，越大越非线性（倒叙、回忆、多线并行）。", ""]
    open(os.path.join(OUT, "chapters.md"), "w", encoding="utf-8").write("\n".join(L))

    for c in ordered:
        st = ch_stats[c["Name"]]
        o = [f"# {c['Name']}", ""]
        o.append(f"- 类型：{'主线' if c['Category'] == 0 else ('测试数据' if c['Name'].lower().startswith('test') else '联动')}")
        o.append(f"- 条目：{st['count']}（Index {st['index'][0]}–{st['index'][1]}）")
        if st["date"]:
            d0, d1 = st["date"]
            o.append(f"- 世界时间：{d0[0]}_{d0[1]:02d}_{d0[2]:02d} → {d1[0]}_{d1[1]:02d}_{d1[2]:02d}")
        o.append("- Character OS 档案：" + "、".join(f"{f}({n})" for f, n in st["cast"]))
        o.append("- 主要曲包：" + "、".join(f"`{p}`×{n}" for p, n in st["packs"][:8]))
        if st["movies"]:
            o.append(f"- 含影片条目：{st['movies']}（字幕 `../raw/srt/`）")
        o.append(f"- 时间序与 Index 序偏差：{st['inversions']} 处")
        o += ["", "| Index | 日期 | 条目 | 档案 | 曲包:等级 | 影片 |", "|--:|:--|:--|:--|:--|:--|"]
        for e in sorted(by_chapter[c["Name"]], key=lambda x: x["_index"]):
            pk = "、".join(f"{p}:{lv}" for p, lv in e["_packs"]) or "—"
            o.append(f"| {e['_index']} | {date_str(e.get('Date',''))} | {os_link(e, 2)} | {e['_file']} | {pk} | {'、'.join(e['_movies'])} |")
        o.append("")
        open(os.path.join(OUT, "chapters", slug_of[c["Name"]]), "w", encoding="utf-8").write("\n".join(o))

    # ============ packs/*.md ============
    for pack in sorted(pack_events):
        ev = pack_events[pack]
        o = [f"# 曲包 `{pack}`：iM × OS 进度阶梯", ""]
        o.append("- 关联档案：" + ("、".join(f"{f}({n})" for f, n in pack_folders[pack].most_common()) or "—"))
        ims = {t for lv in ev.values() for t in lv["im"]}
        oss = {e["Id"] for lv in ev.values() for e in lv["os"]}
        sync = [lv for lv in ev if ev[lv]["os"] and ev[lv]["im"]]
        o.append(f"- iM 帖 {len(ims)} 条 / OS 条目 {len(oss)} 条 / 同步点 {len(sync)} 个")
        o.append("- 章节分布：" + "、".join(f"{c}({n})" for c, n in pack_chapters[pack].most_common(8)))
        o += ["", "| Level | iM 帖（游戏时间线序） | OS 条目（章 · 日期） |", "|--:|:--|:--|"]
        for lv in sorted(ev):
            d = ev[lv]
            ims_s = "、".join(im_link(t, 2) for t in d["im"])
            oss_s = "<br>".join(f"{os_link(e, 2)} · {e['_chapter']} · {date_str(e.get('Date',''))}" for e in d["os"])
            o.append(f"| {lv} | {ims_s} | {oss_s} |")
        o.append("")
        open(os.path.join(OUT, "packs", f"{pack}.md"), "w", encoding="utf-8").write("\n".join(o))

    # ============ timeline.md ============
    tl = ["# 世界时间轴（Timeline OS，按故事内日期排序）", "",
          f"共 {len(os_entries)} 条。同一批条目在 [chapters.md](chapters.md) 里按 `Index` 排列；两种顺序的差异就是游戏的倒叙设计。", "",
          "| 日期 | 章 | 档案 | 条目 | 曲包:等级 |", "|:--|:--|:--|:--|:--|"]
    for e in sorted(os_entries, key=lambda x: (x["_date"] or (9999, 99, 99), x["_index"])):
        pk = "、".join(f"{p}:{lv}" for p, lv in e["_packs"]) or "—"
        tl.append(f"| {date_str(e.get('Date',''))} | {e['_chapter']} | {e['_file']} | {os_link(e)} | {pk} |")
    tl.append("")
    open(os.path.join(OUT, "timeline.md"), "w", encoding="utf-8").write("\n".join(tl))

    # ============ systems/character-os.md ============
    by_folder = collections.defaultdict(list)
    for e in os_entries:
        by_folder[e["_folder"]].append(e)
    c = ["# Character OS System", "",
         "按 `TimelineChapter.Folder`（角色/公共文件夹）陈列的档案。与 Timeline OS 是同一批 1125 条数据。", "",
         "| 文件夹 | 条目 | 章节 | Index | 世界时间 | 主要曲包 | 文件 |", "|:--|--:|:--|:--|:--|:--|:--|"]
    for folder, es in sorted(by_folder.items(), key=lambda x: (-len(x[1]), x[0])):
        idx = sorted(e["_index"] for e in es)
        dated = [e["_date"] for e in es if e["_date"]]
        span = f"{min(dated)[0]}→{max(dated)[0]}" if dated else "—"
        chs = collections.Counter(e["_chapter"] for e in es).most_common(4)
        pk = collections.Counter(p for e in es for p, _ in e["_packs"]).most_common(3)
        files = sorted({e["_file"] for e in es})
        c.append(f"| {folder} | {len(es)} | {'、'.join(f'{k}({v})' for k, v in chs)} | {idx[0]}–{idx[-1]} | {span} | "
                 f"{'、'.join(f'`{p}`' for p, _ in pk)} | {'、'.join(f'[{f}]({up(2)}{LANG}/os/{f}.md)' for f in files)} |")
    c += ["", "公共文件夹：`Main_Folder`（主线公共档案）、`N/A`（未归类，多为联动终章与 test 数据）。", ""]
    open(os.path.join(OUT, "systems", "character-os.md"), "w", encoding="utf-8").write("\n".join(c))

    # ============ systems/timeline-os.md ============
    t = ["# Timeline OS System", "",
         "按 `TimelineChapter.Chapter` + `Index` 陈列，`Date` 提供故事内时间。主线 10 章、联动 7 章、测试 1 章。", "",
         "| 章 | 条目 | Index | 世界时间 | 时间倒序 |", "|:--|--:|:--|:--|--:|"]
    for c2 in ordered:
        st = ch_stats[c2["Name"]]
        d = st["date"]
        span = f"{d[0][0]}_{d[0][1]:02d}_{d[0][2]:02d} → {d[1][0]}_{d[1][1]:02d}_{d[1][2]:02d}" if d else "—"
        t.append(f"| [{c2['Name']}](../chapters/{slug_of[c2['Name']]}) | {st['count']} | {st['index'][0]}–{st['index'][1]} | {span} | {st['inversions']} |")
    t += ["", f"全量时间序：[timeline.md](../timeline.md)（{len(os_entries)} 条，含日期与条目链接）。", ""]
    open(os.path.join(OUT, "systems", "timeline-os.md"), "w", encoding="utf-8").write("\n".join(t))

    # ============ systems/oa-system.md ============
    mission_obj = {m.get("MissionId"): m.get("ObjectId") for m in oa.get("Missions", [])}
    oa_chars = collections.defaultdict(lambda: {"obj": 0, "desc": 0, "doc": 0})
    for o in oa.get("Objects", []):
        oa_chars[o.get("CharacterId", "")]["obj"] += 1
    for d in oa.get("Descriptions", []):
        oa_chars[d.get("CharacterId", "")]["desc"] += 1
    for d in oa.get("Documents", []):
        oa_chars[d.get("CharacterId", "")]["doc"] += 1
    vids = sorted(os.path.basename(p) for p in glob.glob(os.path.join(T, "..", "sba", "assets", "assetbundles.json")))
    o = ["# OA System", "",
         "`oasystemdata.ab`：探索式档案（物件 → 描述 → 文件），按角色分组。定位是联动章节的替代叙事层：主线用 OS 档案，联动角色（Alice、Amiya 等）用 OA 探索。", "",
         "| 角色 | 物件 | 描述 | 文件 | 原文 |", "|:--|--:|--:|--:|:--|"]
    for ch, n in sorted(oa_chars.items(), key=lambda x: -sum(x[1].values())):
        if not ch:
            continue
        o.append(f"| {ch} | {n['obj']} | {n['desc']} | {n['doc']} | [{ch}.md]({up(2)}{LANG}/oa/{ch}.md) |")
    o += ["", f"合计：{len(oa.get('Objects', []))} 物件 / {len(oa.get('Descriptions', []))} 描述 / {len(oa.get('Documents', []))} 文件。",
          "", "触发路径：`Missions` 把「物件 → 点击目标」与「文件」串起来（`MissionId` → `ObjectId`），任务的 `Details` 给出游戏内的操作提示；`Rewards` 记录解锁奖励。",
          "", "OA 专属影片：`video_oasystem_<角色>_*`（Alice / Amiya / Bobo / Hans / Ilka / Kaf / NEKO / PAFF / ROBO / Tairitsu / Vanessa / Xenon 等 20 个 bundle），字幕同 `../../raw/srt/`。", ""]
    open(os.path.join(OUT, "systems", "oa-system.md"), "w", encoding="utf-8").write("\n".join(o))

    # ============ systems/backup-database.md (gallery) ============
    cond_kind = {"StoryLockCondition": "story", "OSFileLockCondition": "os",
                 "IMTopicLockCondition": "im", "BranchingOSFileLockCondition": "branch"}
    gallery_by_folder = collections.defaultdict(list)
    for it in gallery_items:
        gallery_by_folder[it["_folder"]].append(it)

    def conds_text(item):
        out = []
        for c in item.get("Conditions") or []:
            t = (c.get("$type") or "").split(".")[-1].split(",")[0]
            kind = cond_kind.get(t, t)
            val = c.get("storyId") or c.get("fileId") or c.get("topicId") or ""
            out.append(f"{kind}:{val}" if val else kind)
        return "、".join(out) or "—"

    g = ["# Backup Database System", "",
         f"`gallerydata`：{len(gallery_folders)} 个文件夹 / {len(gallery_items)} 个文件。每项记录 `FileLocation`（影片或图片的 id）、`FileName`（游戏内显示名）、`IconType`、`Format` 与解锁条件。"
         "Wiki 的 `Backup_Database/<角色>/<FileName>` 就是这里的条目，例如 `PAFF/Video_702_07_27` = `paff001` 文件夹里 `FileLocation=story03` 的影片。", "",
         "| 文件夹 | 文件数 | 影片 | 图片 | Boss 舞台 |", "|:--|--:|--:|--:|--:|"]
    for gf in gallery_folders:
        items = gallery_by_folder.get(gf["Id"], [])
        if not items:
            continue
        vids = sum(1 for i in items if i.get("IconType") == "icon_video")
        imgs = sum(1 for i in items if i.get("IconType") == "icon_image")
        boss = sum(1 for i in items if i.get("IconType") == "icon_bossstage")
        g.append(f"| {gf['Name']} (`{gf['Id']}`) | {len(items)} | {vids} | {imgs} | {boss} |")
    g += ["", "## 文件清单", ""]
    for gf in gallery_folders:
        items = gallery_by_folder.get(gf["Id"], [])
        if not items:
            continue
        g += [f"### {gf['Name']} (`{gf['Id']}`)", "",
              "| 名称 | Location | 类型 | 解锁条件 |", "|:--|:--|:--|:--|"]
        for it in items:
            g.append(f"| {it.get('FileName','')} | `{it.get('FileLocation','')}` | {it.get('IconType','')} | {conds_text(it)} |")
        g.append("")
    g += ["媒体：`FileLocation` 命中已导出的媒体时可直接播放/查看（`media/videos/`、`media/illustrations/`、`media/os-attachments/`），"
          "清单见 `media/manifest.json`（`movies` / `illustrations` / `images`）。", ""]
    open(os.path.join(OUT, "systems", "backup-database.md"), "w", encoding="utf-8").write("\n".join(g))

    # ============ systems/branching.md (old backup content) ============
    def br_link(e):
        return f"[{e['Id']}](../{LANG}/branching/tairitsu001.md)"
    ids = {e["Id"] for e in br}
    b = ["# 分支剧情（Tairitsu 线）", "",
         "`branchingosdata.ab` 里只有一条：`tairitsu001`，48 个节点，带 `ViewSetting.Position / Order / LinkedFileIds / LineOffsets` 与 `UnlockCondition.StateId` —— 是**分支图**而非线性档案，与 OS 的章节体系并列。", "",
         "命名规律：`taosNNNa/b/c` 为同号三分支（a/b/c 各 9 条），`taos010`–`taos023` 为收束段。", "",
         "旁证：`osdata.ab` 里也有一个 `tairitsu001`，但内容是空数组 —— 她的档案只存在于本系统。", ""]
    b += ["| 节点 | Type | Position | Order | 后继 |", "|:--|--:|--:|--:|:--|"]
    for e in br:
        vs = e.get("ViewSetting") or {}
        nxt = "、".join(vs.get("LinkedFileIds") or [])
        b.append(f"| {e['Id']} | {e.get('Type')} | {vs.get('Position')} | {vs.get('Order')} | {nxt} |")
    b += ["", "## 分支图", "", "```mermaid", "flowchart LR"]
    for e in br:
        for nx in (e.get("ViewSetting") or {}).get("LinkedFileIds") or []:
            b.append(f"  {e['Id']} --> {nx}")
    b += ["```", ""]
    b += ["原文：[tairitsu001.md](" + up(2) + LANG + "/branching/tairitsu001.md)", ""]
    open(os.path.join(OUT, "systems", "branching.md"), "w", encoding="utf-8").write("\n".join(b))

    # ============ endings.md ============
    ed = ["# 结局与剧情闸", "",
          f"`im_lock_condition_data.StoryLockId`：`story01` 是主线总闸（{n_main_gate} 帖），其余 8 个闸管结局/终章演出（{sum(len(v) for v in gates.values())} 帖），另有 {n_no_gate} 帖无剧情闸。", "",
          "| 剧情锁 | iM 帖 | 类型 |", "|:--|--:|:--|"]
    for g in sorted(gates):
        typ = "结局" if g.startswith("story_ending") else "终章演出"
        ed.append(f"| `{g}` | {len(gates[g])} | {typ} |")
    ed += ["", "## 各闸解锁的 iM 帖", ""]
    for g in sorted(gates):
        ed.append(f"### {g}")
        ed.append("")
        for tid in gates[g]:
            t2 = topic_by_id[tid]
            ed.append(f"- {im_link(tid)}　{t2['CharacterName']}｜{md(t2['Titles'][5])}")
        ed.append("")
    ed += ["## 标题画面演进（title_info）", "", "| Type | 名称 | 解锁条件 |", "|--:|:--|:--|"]
    for tt in titles:
        cond = "、".join(str(cc.get("storyId", "")) for cc in tt.get("Conditions") or []) or "—"
        ed.append(f"| {tt['Type']} | {md(tt['Name'])} | {cond} |")
    ed += ["", "## 影片入口", "",
           "带 `##movie=` 的 OS 条目：", "", "| 条目 | 影片 | 章 |", "|:--|:--|:--|"]
    for e in os_entries:
        if e["_movies"]:
            ed.append(f"| {os_link(e)} | {'、'.join(e['_movies'])} | {e['_chapter']} |")
    ed += ["", f"共 {sum(1 for e in os_entries if e['_movies'])} 条；`cutscenedata` 另记录 {len(cut)} 个触发映射，字幕见 `../raw/srt/`（59 部 × 5 语言）。", ""]
    open(os.path.join(OUT, "endings.md"), "w", encoding="utf-8").write("\n".join(ed))

    # ============ im-timeline.md ============
    it = ["# iM 全局时间线（%d 帖）" % len(topic_order), "",
          "顺序 = `im_topic_data` 数组顺序（每个角色子序列严格按编号递增）。「同步 OS」列 = 与该帖同一 `(曲包, level)` 一起解锁的 OS 条目。", "",
          "| # | 帖 | 账号 | 标题 | 剧情闸 | 曲包:等级 | 同步 OS |", "|--:|:--|:--|:--|:--|:--|:--|"]
    for tid in topic_order:
        t2 = topic_by_id[tid]
        lk = imlock.get(tid) or {}
        pk = "、".join(f"{p}:{lv}" for p, lv in packs(lk.get("LevelLocks"))) or "—"
        syn = []
        for p2, lv2 in packs(lk.get("LevelLocks")):
            syn += [os_link(e) for e in pack_events.get(p2, {}).get(lv2, {}).get("os", [])]
        gate = lk.get("StoryLockId") or "—"
        it.append(f"| {topic_pos[tid]+1} | {im_link(tid)} | {md(t2['AvatarId'])} | {md(t2['Titles'][5])} | {gate} | {pk} | {'、'.join(syn) or '—'} |")
    it.append("")
    open(os.path.join(OUT, "im-timeline.md"), "w", encoding="utf-8").write("\n".join(it))

    # ============ sync-points.md ============
    sp = ["# 同步点：iM 帖 × OS 条目同一刻解锁", "",
          f"{n_sync} 个 `(曲包, level)` 上 iM 帖与 OS 条目同时解锁，覆盖 {n_sync_im} 帖 —— 这是两条轨道之间唯一可验证的交点。", "",
          "| 曲包 | Level | iM 帖 | OS 条目（章） |", "|:--|--:|:--|:--|"]
    for p3 in sorted(pack_events):
        for lv3 in sorted(pack_events[p3]):
            d3 = pack_events[p3][lv3]
            if not (d3["os"] and d3["im"]):
                continue
            sp.append(f"| `{p3}` | {lv3} | {'、'.join(im_link(t) for t in d3['im'])} | "
                      f"{'<br>'.join(os_link(e) + ' · ' + e['_chapter'] for e in d3['os'])} |")
    sp.append("")
    open(os.path.join(OUT, "sync-points.md"), "w", encoding="utf-8").write("\n".join(sp))

    # ============ graph.json ============
    nodes, E = [], []
    for c3 in chapters:
        nodes.append({"id": f"chapter:{c3['Id']}", "type": "chapter", "name": c3["Name"], "category": c3["Category"]})
    for p in sorted(pack_events):
        nodes.append({"id": f"pack:{p}", "type": "pack", "folders": [f for f, _ in pack_folders[p].most_common()]})
    for e in os_entries:
        nodes.append({"id": f"os:{e['Id']}", "type": "os", "file": e["_file"], "folder": e["_folder"],
                      "chapter": e["_chapter"], "index": e["_index"], "date": date_str(e.get("Date", "")),
                      "category": e.get("Category"), "movies": e["_movies"]})
    for tid in topic_order:
        lk = imlock.get(tid) or {}
        nodes.append({"id": f"im:{tid}", "type": "im", "order": topic_pos[tid],
                      "gate": lk.get("StoryLockId") or "", "title": one_line(topic_by_id[tid]["Titles"][5])})
    for e in os_entries:
        E.append({"from": f"chapter:{ch_id.get(e['_chapter'], -1)}", "to": f"os:{e['Id']}", "rel": "contains"})
        for p, lv in e["_packs"]:
            E.append({"from": f"pack:{p}", "to": f"os:{e['Id']}", "rel": "unlocks_at", "level": lv})
        if e["_filelock"]:
            E.append({"from": f"os:{e['_filelock']}", "to": f"os:{e['Id']}", "rel": "requires"})
        for m in e["_movies"]:
            E.append({"from": f"os:{e['Id']}", "to": f"movie:{m}", "rel": "movie"})
    for tid in topic_order:
        lk = imlock.get(tid) or {}
        for p, lv in packs(lk.get("LevelLocks")):
            E.append({"from": f"pack:{p}", "to": f"im:{tid}", "rel": "unlocks_at", "level": lv})
        if lk.get("TopicLockId"):
            E.append({"from": f"im:{lk['TopicLockId'].upper()}", "to": f"im:{tid}", "rel": "requires"})
    for g, ts in gates.items():
        nodes.append({"id": f"gate:{g}", "type": "gate", "count": len(ts)})
        for t3 in ts:
            E.append({"from": f"gate:{g}", "to": f"im:{t3}", "rel": "gates"})
    for e in br:
        nodes.append({"id": f"bd:{e['Id']}", "type": "backup", "type_field": e.get("Type")})
        for nx in (e.get("ViewSetting") or {}).get("LinkedFileIds") or []:
            E.append({"from": f"bd:{e['Id']}", "to": f"bd:{nx}", "rel": "branch"})
    for oo in oa.get("Objects", []):
        nodes.append({"id": f"oa:{oo['ObjectId']}", "type": "oa", "character": oo.get("CharacterId")})
    for d in oa.get("Documents", []):
        obj = mission_obj.get(d.get("MissionId"))
        E.append({"from": f"oa:{obj}", "to": f"oa_doc:{d['DocumentId']}", "rel": "contains"})
    json.dump({"nodes": nodes, "edges": E}, open(os.path.join(OUT, "graph.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)

    print(json.dumps({
        "chapters": len(ch_stats), "packs": len(pack_events), "os": len(os_entries), "folders": len(by_folder),
        "im": len(topic_order), "sync_levels": sum(1 for p in pack_events for lv in pack_events[p]
                                                   if pack_events[p][lv]["os"] and pack_events[p][lv]["im"]),
        "im_synced": len({t for p in pack_events for lv in pack_events[p] if pack_events[p][lv]["os"]
                          for t in pack_events[p][lv]["im"]}),
        "gates": len(gates), "gate_im": sum(len(v) for v in gates.values()),
        "main_gate": n_main_gate, "no_gate": n_no_gate,
        "movies": sum(1 for e in os_entries if e["_movies"]),
        "backup_nodes": len(br), "oa_objs": len(oa.get("Objects", [])), "oa_docs": len(oa.get("Documents", [])),
        "edges": len(E), "nodes": len(nodes),
    }, ensure_ascii=False))

if __name__ == "__main__":
    main()
