#!/usr/bin/env python3
"""Export the extracted Cytus II story into structured JSON for the browser viewer.

Output: viewer/public/data/index.json + content.<lang>.json

Block kinds emitted by the script parser:
  dialogue     {speaker, text}
  narration    {text}
  image        {id}
  imageviewer  {id}
  movie        {id}
  mail         {title, from, to, body}
  note         {directive, value}   (unrecognised ##directive, kept verbatim)
"""
import json, os, re, glob, subprocess, collections

T = "text"
ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
APK = os.path.join(ROOT_DIR, "..")
if not os.path.exists(os.path.join(APK, "base.apk")):
    APK = os.path.join(ROOT_DIR, "..", "cytus2")
TMP = os.path.join(ROOT_DIR, "media_bundles")
OUT = "../viewer/public/data"
LANGS = [
    ("en", "English", 0),
    ("ja", "日本語", 1),
    ("zh-Hant", "繁體中文", 2),
    ("ko", "한국어", 3),
    ("zh-Hans", "简体中文", 5),
]
TAG_RE = re.compile(r"</?(?:size|color|i|b|u|font_[0-9A-Za-z]+)(?:=[^>]*)?>")

def load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)

def strip_tags(s):
    return TAG_RE.sub("", s or "")

def one_line(s):
    return " ".join(strip_tags(s or "").split())

def parse_date(s):
    if not s:
        return None
    s = str(s).strip().replace("\n", " ")
    m = re.match(r"(\d{3,4})_(\d{2})_(\d{2})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?", s)
    if not m:
        return None
    g = [int(x) if x else 0 for x in m.groups()]
    return g + [0] * (6 - len(g))

def iso_date(parts):
    return "%03d_%02d_%02d %02d:%02d" % tuple(parts[:5]) if parts else ""

def parse_blocks(text):
    """Game script -> structured blocks."""
    blocks = []
    speaker = None
    mode = "dialogue"
    para = []
    pending_viewer = None

    def flush():
        nonlocal para
        if para:
            blocks.append({"kind": "narration", "text": "\n".join(para)})
            para = []

    for raw in (text or "").split("\n"):
        line = raw.rstrip()
        if pending_viewer is not None:
            viewer, pending_viewer = pending_viewer, None
            if line.strip().startswith("{"):
                try:
                    payload = json.loads(line)
                except Exception:
                    payload = {}
                if viewer == "booklet":
                    body = (payload.get("Content") or "").replace("\r\n", "\n")
                    paras = [p.strip("\n") for p in body.split("\n\n") if p.strip()]
                    blocks.append({
                        "kind": "booklet",
                        "title": one_line(payload.get("Title") or ""),
                        "subtitle": one_line(payload.get("Subtitle") or ""),
                        "paragraphs": [p.strip() for p in paras],
                    })
                else:
                    blocks.append({
                        "kind": "imageviewer",
                        "id": payload.get("Image") or "",
                        "viewer": viewer,
                    })
                continue
        if line.startswith("##"):
            key, _, val = line[2:].partition("=")
            key, val = key.strip(), val.strip()
            if key == "conversation":
                flush()
                speaker = one_line(val)
                mode = "dialogue"
            elif key == "text":
                flush()
                speaker = None
                mode = "text"
            elif key == "bgm":
                if val.strip().lower() not in ("mute", ""):
                    flush()
                    blocks.append({"kind": "bgm", "name": val.strip()})
            elif key == "sound":
                flush()
                name, _, label = val.partition(",")
                blocks.append({"kind": "sound", "name": name.strip(), "label": label.strip()})
            elif key in ("se", "camera"):
                continue
            elif key == "image":
                flush()
                blocks.append({"kind": "image", "id": val})
            elif key == "movie":
                flush()
                blocks.append({"kind": "movie", "id": val})
            elif key == "json":
                flush()
                pending_viewer = val
            elif key == "mail":
                flush()
                parts = [one_line(x) for x in val.split(",")]
                while len(parts) < 3:
                    parts.append("")
                blocks.append({"kind": "mail", "title": parts[0], "from": parts[1], "to": parts[2],
                               "body": ""})
                mode = "mail"
                speaker = None
            else:
                flush()
                blocks.append({"kind": "note", "directive": key, "value": val})
            continue
        s = strip_tags(line).strip()
        if not s:
            flush()
            continue
        if mode == "mail" and blocks and blocks[-1]["kind"] == "mail":
            b = blocks[-1]
            b["body"] = (b["body"] + "\n" + s).strip("\n")
        elif mode == "dialogue" and speaker:
            blocks.append({"kind": "dialogue", "speaker": speaker, "text": s})
        else:
            para.append(s)
    flush()
    return blocks


def load_bundle_textasset(bundle, text_name=None):
    """从 assets/assetpack/<bundle> 里读 TextAsset（illustrationdata 这类没落到 text/ 的表）。"""
    import UnityPy
    path = os.path.join(TMP, bundle)
    if not os.path.exists(path):
        for apk in ("split_assets_pack_1.apk", "split_assets_pack_2.apk"):
            subprocess.run(["unzip", "-o", "-q", "-j", os.path.join(APK, apk),
                            f"assets/assetpack/{bundle}", "-d", TMP], capture_output=True)
            if os.path.exists(path):
                break
    if not os.path.exists(path):
        return None
    env = UnityPy.load(path)
    for o in env.objects:
        if o.type.name != "TextAsset":
            continue
        d = o.read_typetree()
        if text_name and d.get("m_Name") != text_name:
            continue
        return json.loads(d["m_Script"])
    return None

def main():
    os.makedirs(OUT, exist_ok=True)

    trigger_path = os.path.join(ROOT_DIR, "story_triggers.json")
    triggers = load(trigger_path)["triggers"] if os.path.exists(trigger_path) else {}
    gallery_folders = load(os.path.join(T, "gallerydata", "folder"))
    char_names = {f["Id"]: f["Name"] for f in gallery_folders}

    def _norm(x):
        return "".join(ch for ch in x.lower() if ch.isalnum())

    # gallerydata/folder 缺 ConneR / Xenon / Graff.J，用 osdata 里出现过的 Folder 名做显示名池
    name_pool = set(char_names.values())
    for _f in sorted(os.listdir(os.path.join(T, "osdata"))):
        if _f == "chapters":
            continue
        for _e in load(os.path.join(T, "osdata", _f)):
            _fo = (_e.get("TimelineChapter") or {}).get("Folder") or ""
            if _fo and _fo != "N/A" and not re.fullmatch(r"[a-z]+\d{3}", _fo):
                name_pool.add(_fo)
    by_norm = {_norm(v): v for v in name_pool}

    # 角色编号 → 显示名（角色维度，和 Folder 维度互不复用）
    def char_display(cid):
        if cid in char_names:
            return char_names[cid]
        return by_norm.get(_norm(re.sub(r"\d+$", "", cid)), cid)

    chapters = load(os.path.join(T, "osdata", "chapters"))
    ch_id = {c["Name"]: c["Id"] for c in chapters}

    topics = load(os.path.join(T, "imdata", "im_topic_data"))
    order = [t["Id"].upper() for t in topics]
    by_id = {t["Id"].upper(): t for t in topics}
    imlock = {e["TopicId"].upper(): e for e in load(os.path.join(T, "imdata", "im_lock_condition_data"))}

    # 首次打开档案时播放的过场影片（cutscenedata/cutscene_data_os：TriggerId → MovieFile）
    cutscene_os = load(os.path.join(T, "cutscenedata", "cutscene_data_os"))
    cutscene_movie = {
        k: (v.get("MovieFile") or "")[:-4]
        for k, v in cutscene_os.items()
        if (v.get("MovieFile") or "").endswith(".mp4")
    }

    # ---------- OS ----------
    os_entries = []
    for f in sorted(os.listdir(os.path.join(T, "osdata"))):
        if f == "chapters":
            continue
        for e in load(os.path.join(T, "osdata", f)):
            tl = e.get("TimelineChapter") or {}
            lock = e.get("OSLockCondition") or {}
            movies = []
            for c in e.get("Contents") or []:
                if isinstance(c, str):
                    movies += [ln.split("=", 1)[1].strip() for ln in c.splitlines() if ln.startswith("##movie=")]
            # 两个维度互不复用：folder 是 TIMELINE CHAPTER 的文件夹（可能为 "N/A"/联合文件夹），
            # character 是 osdata 文件名对应的角色（TIMELINE BY VERSION 用）
            os_entries.append({
                "id": e["Id"],
                "file": f,
                "folder": tl.get("Folder") or "",
                "characterId": f,
                "character": char_display(f),
                "chapter": tl.get("Chapter", ""),
                "index": tl.get("Index", 0),
                "date": iso_date(parse_date(e.get("Date"))),
                "category": e.get("Category"),
                "type": e.get("Type"),
                "packs": [[x.get("SongPackId"), x.get("Level")] for x in lock.get("LevelLocks") or []],
                "fileLock": lock.get("FileLockId") or "",
                "movies": sorted(set(movies)),
                "cutscene": cutscene_movie.get(e["Id"]),
                "names": {code: one_line((e.get("Names") or [""] * 6)[slot]) for code, _, slot in LANGS},
                "raw": e.get("Contents") or [],
            })

    # ---------- iM ----------
    posts = {}
    for f in glob.glob(os.path.join(T, "imposts_*", "posts")):
        p = load(f)
        posts[p["Id"].upper()] = p

    def reply_tree(node, slot):
        return {
            "id": node.get("Id", ""),
            "author": one_line(node.get("CharacterName", "")),
            "avatar": node.get("AvatarId", ""),
            "text": strip_tags((node.get("Contents") or [""] * 6)[slot]).strip(),
            "attachments": node.get("Attachments") or [],
            "replies": [reply_tree(r, slot) for r in node.get("Replies") or []],
        }

    # ---------- OA ----------
    oa = load(os.path.join(T, "oasystemdata", "oa_system_data"))
    mission_obj = {m.get("MissionId"): m.get("ObjectId") for m in oa.get("Missions", [])}

    # ---------- Backup Database (gallery) ----------
    gallery_dir = os.path.join(T, "gallerydata")
    gallery_folders = load(os.path.join(gallery_dir, "folder"))
    gallery_items = []
    for gf in gallery_folders:
        path = os.path.join(gallery_dir, gf["Id"])
        if not os.path.exists(path):
            continue
        for it in load(path):
            conds = []
            for c in it.get("Conditions") or []:
                t = (c.get("$type") or "").split(".")[-1].split(",")[0]
                if t == "StoryLockCondition":
                    conds.append(f"story:{c.get('storyId')}")
                elif t == "OSFileLockCondition":
                    conds.append(f"os:{c.get('fileId')}")
                elif t == "IMTopicLockCondition":
                    conds.append(f"im:{c.get('topicId')}")
                elif t == "BranchingOSFileLockCondition":
                    conds.append(f"branch:{c.get('fileId')}")
                else:
                    conds.append(t)
            size = None
            loc = (it.get("Location") or "").strip()
            if "," in loc:
                try:
                    w, h = (int(x) for x in loc.split(",", 1))
                    if w > 0 and h > 0:
                        size = [w, h]
                except ValueError:
                    size = None
            gallery_items.append({
                "folder": gf["Id"],
                "location": it.get("FileLocation", ""),
                "name": it.get("FileName", ""),
                "icon": it.get("IconType", ""),
                "format": it.get("Format"),
                "size": size,
                "conditions": conds,
            })

    # ---------- branching (Tairitsu) ----------
    br = load(os.path.join(T, "branchingosdata", "tairitsu001"))

    # ---------- structure (index.json) ----------
    pack_events = collections.defaultdict(lambda: collections.defaultdict(lambda: {"im": [], "os": []}))
    pack_folders = collections.defaultdict(collections.Counter)
    pack_chapters = collections.defaultdict(collections.Counter)
    for e in os_entries:
        for p, lv in e["packs"]:
            pack_events[p][lv]["os"].append(e["id"])
            pack_folders[p][e["folder"]] += 1
            pack_chapters[p][e["chapter"]] += 1
    for tid in order:
        for lk in ((imlock.get(tid) or {}).get("LevelLocks") or []):
            pack_events[lk.get("SongPackId")][lk.get("Level")]["im"].append(tid)

    by_chapter = collections.defaultdict(list)
    by_folder = collections.defaultdict(list)
    for e in os_entries:
        by_chapter[e["chapter"]].append(e)
        by_folder[e["folder"]].append(e)

    ch_stats = {}
    for name, es in by_chapter.items():
        dated = [e["date"] for e in es if e["date"]]
        idx = sorted(e["index"] for e in es)
        seq = sorted(es, key=lambda x: (x["date"] or "9", x["index"]))
        pos = {e["id"]: i for i, e in enumerate(sorted(es, key=lambda x: x["index"]))}
        inversions = sum(1 for i in range(1, len(seq)) if pos[seq[i]["id"]] < pos[seq[i - 1]["id"]])
        ch_stats[name] = {
            "id": ch_id.get(name, -1),
            "name": name,
            "count": len(es),
            "index": [idx[0], idx[-1]],
            "date": [min(dated), max(dated)] if dated else None,
            "folders": [f for f, _ in collections.Counter(e["folder"] for e in es).most_common()],
            "packs": [[p, n] for p, n in collections.Counter(p for e in es for p, _ in e["packs"]).most_common()],
            "inversions": inversions,
            "movies": sum(1 for e in es if e["movies"]),
            "entries": [e["id"] for e in sorted(es, key=lambda x: x["index"])],
        }
    chapter_meta = {c["Name"]: c for c in chapters}
    chapter_list = sorted(ch_stats.values(),
                          key=lambda s: (0 if chapter_meta[s["name"]]["Category"] == 0 else 1,
                                         s["index"][0] if chapter_meta[s["name"]]["Category"] == 0 else s["id"]))
    for s in chapter_list:
        s["category"] = chapter_meta[s["name"]]["Category"]

    folder_list = []
    for name, es in sorted(by_folder.items(), key=lambda x: (-len(x[1]), x[0])):
        folder_list.append({
            "name": name,
            "count": len(es),
            "chapters": [c for c, _ in collections.Counter(e["chapter"] for e in es).most_common()],
            "packs": [p for p, _ in collections.Counter(p for e in es for p, _ in e["packs"]).most_common()],
            "entries": [e["id"] for e in es],
        })

    pack_list = []
    for p in sorted(pack_events):
        levels = []
        for lv in sorted(pack_events[p]):
            d = pack_events[p][lv]
            levels.append({"level": lv, "im": d["im"], "os": d["os"]})
        pack_list.append({
            "id": p,
            "folders": [f for f, _ in pack_folders[p].most_common()],
            "chapters": [[c, n] for c, n in pack_chapters[p].most_common()],
            "levels": levels,
            "imCount": len({t for lv in levels for t in lv["im"]}),
            "osCount": len({t for lv in levels for t in lv["os"]}),
            "syncCount": sum(1 for lv in levels if lv["im"] and lv["os"]),
        })

    gates = collections.defaultdict(list)
    for tid in order:
        g = (imlock.get(tid) or {}).get("StoryLockId") or ""
        if g and g != "story01":
            gates[g].append(tid)

    sync = [{"pack": p["id"], "level": lv["level"], "im": lv["im"], "os": lv["os"]}
            for p in pack_list for lv in p["levels"] if lv["im"] and lv["os"]]

    im_meta = []
    for i, tid in enumerate(order):
        t = by_id[tid]
        lk = imlock.get(tid) or {}
        p = posts.get(tid) or {}
        im_meta.append({
            "id": tid,
            "order": i + 1,
            "author": one_line(p.get("CharacterName", t.get("CharacterName", ""))),
            "avatar": t.get("AvatarId", ""),
            "titles": {code: one_line((t.get("Titles") or [""] * 6)[slot]) for code, _, slot in LANGS},
            "gate": lk.get("StoryLockId") or "",
            "packs": [[x.get("SongPackId"), x.get("Level")] for x in lk.get("LevelLocks") or []],
            "attachments": p.get("Attachments") or [],
            "charts": t.get("UnlockCharts") or [],
            "likes": t.get("LikeCount", 0),
            "replies": sum(_count_replies(p)),
            "storyTrigger": triggers.get(tid),
        })

    oa_chars = []
    for ch in sorted({o.get("CharacterId", "") for o in oa.get("Objects", [])} |
                     {d.get("CharacterId", "") for d in oa.get("Descriptions", [])} |
                     {d.get("CharacterId", "") for d in oa.get("Documents", [])}):
        if not ch:
            continue
        oa_chars.append({
            "character": ch,
            "objects": [o.get("ObjectId") for o in oa.get("Objects", []) if o.get("CharacterId") == ch],
            "descriptions": [d.get("Id") for d in oa.get("Descriptions", []) if d.get("CharacterId") == ch],
            "documents": [d.get("DocumentId") for d in oa.get("Documents", []) if d.get("CharacterId") == ch],
        })

    # ---------- 角色名（游戏内显示名，含 stylized 写法） ----------
    def _norm(x):
        return "".join(ch for ch in x.lower() if ch.isalnum())

    characters = {f["Id"]: f["Name"] for f in gallery_folders}
    folder_by_norm = {_norm(f["name"]): f["name"] for f in folder_list}
    for cid in {p["id"] for p in pack_list} | {c["character"] for c in oa_chars}:
        if cid in characters:
            continue
        base = re.sub(r"\d+$", "", cid)
        characters[cid] = folder_by_norm.get(_norm(base), cid)

    ill_raw = load_bundle_textasset("illustrationdata.ab", "illustration") or []
    illustrations = [
        {
            "id": d["Meta"]["Id"],
            "character": d.get("CharacterId", ""),
            "characterName": characters.get(d.get("CharacterId", ""), d.get("CharacterId", "")),
            "costume": d["Meta"].get("Name", ""),
            "available": bool(d.get("IsAvailable")),
        }
        for d in ill_raw
    ]

    backup_nodes = []
    for e in br:
        vs = e.get("ViewSetting") or {}
        backup_nodes.append({
            "id": e["Id"],
            "type": e.get("Type"),
            "names": {code: one_line((e.get("Names") or [""] * 6)[slot]) for code, _, slot in LANGS},
            "position": vs.get("Position"),
            "order": vs.get("Order"),
            "next": vs.get("LinkedFileIds") or [],
            "branch": (e["Id"][-1] if e["Id"][-1] in "abc" else ""),
        })

    titles = load(os.path.join(T, "titleinfodata", "title_info"))

    index = {
        "meta": {
            "title": "Cytus II 剧情阅览",
            "game": "Cytus II",
            "gameVersion": "5.3.0 (96753500)",
            "languages": [{"code": c, "label": l} for c, l, _ in LANGS],
            "counts": {
                "imTopics": len(order),
                "imReplies": sum(m["replies"] for m in im_meta),
                "osEntries": len(os_entries),
                "folders": len(folder_list),
                "chapters": len(chapter_list),
                "packs": len(pack_list),
                "syncPoints": len(sync),
                "gates": len(gates),
                "oaObjects": len(oa.get("Objects", [])),
                "oaDocuments": len(oa.get("Documents", [])),
                "backupNodes": len(backup_nodes),
                "galleryItems": len(gallery_items),
                "galleryFolders": len(gallery_folders),
                "movies": sum(1 for e in os_entries if e["movies"]),
            },
        },
        "chapters": chapter_list,
        "folders": folder_list,
        "packs": pack_list,
        "im": im_meta,
        "os": [{k: v for k, v in e.items() if k != "raw"} for e in os_entries],
        "gates": [{"id": g, "topics": ts} for g, ts in sorted(gates.items())],
        "sync": sync,
        "timeline": [e["id"] for e in sorted(os_entries, key=lambda x: (x["date"] or "9", x["index"]))],
        "characters": characters,
        "illustrations": illustrations,
        "oa": oa_chars,
        "gallery": {
            "folders": [{"id": f["Id"], "name": f["Name"], "avatar": f.get("AvatarId", "")} for f in gallery_folders],
            "items": gallery_items,
        },
        "backup": backup_nodes,
        "branching": backup_nodes,
        "titleInfo": titles,
    }
    json.dump(index, open(os.path.join(OUT, "index.json"), "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))

    # ---------- per-language content ----------
    for code, label, slot in LANGS:
        im = {}
        for tid in order:
            p = posts.get(tid) or {}
            im[tid] = {
                "title": one_line((by_id[tid].get("Titles") or [""] * 6)[slot]),
                "text": strip_tags((p.get("Contents") or [""] * 6)[slot]).strip(),
                "replies": [reply_tree(r, slot) for r in p.get("Replies") or []],
            }
        osv = {}
        for e in os_entries:
            blocks = parse_blocks((e["raw"] or [""] * 6)[slot] if isinstance((e["raw"] or [""] * 6)[slot], str) else "")
            osv[e["id"]] = {"name": e["names"][code], "blocks": blocks}
        oav = {}
        for o in oa.get("Objects", []):
            oav[o["ObjectId"]] = {
                "kind": "object",
                "name": one_line((o.get("Names") or [""] * 6)[slot]),
                "details": one_line((o.get("Details") or [""] * 6)[slot]),
                "character": o.get("CharacterId", ""),
            }
        for d in oa.get("Descriptions", []):
            body = (d.get("Contents") or [""] * 6)[slot]
            body = re.sub(r"</p>", "\n\n", body).replace("<p>", "")
            def _conds(items):
                out = []
                for c in items or []:
                    t = (c.get("$type") or "").split(".")[-1].split(",")[0]
                    if t == "OASystemLevelLock":
                        out.append(f"等级 {c.get('CharacterId', '')}")
                    elif t == "OASystemOSLock":
                        out.append(f"OS {c.get('OSLockId', '')}")
                    elif t == "OASystemStoryLock":
                        out.append(f"剧情 {c.get('StoryId', '')}")
                    else:
                        out.append(t)
                return out

            oav[d.get("Id")] = {
                "kind": "description",
                # 同一点位有多个变体（阶段/解锁条件不同），按 DescriptionObjectId 归组
                "group": d.get("DescriptionObjectId"),
                "event": d.get("DescriptionEvent"),
                "enable": _conds(d.get("EnableCondition")),
                "disable": _conds(d.get("DisableCondition")),
                "character": d.get("CharacterId", ""),
                "name": one_line(d.get("Name", "")),
                "text": strip_tags(body).strip(),
            }
        for d in oa.get("Documents", []):
            oav[d.get("DocumentId")] = {
                "kind": "document",
                "object": mission_obj.get(d.get("MissionId")),
                "character": d.get("CharacterId", ""),
                # 文档名（如 Audio_Aroma_690）之前漏了，导致 OA 搜索搜不到
                "name": one_line((d.get("Names") or [""] * 6)[slot]),
                "blocks": parse_blocks((d.get("Contents") or [""] * 6)[slot]),
            }
        bdv = {e["Id"]: {"blocks": parse_blocks((e.get("Contents") or [""] * 6)[slot])} for e in br}
        subs = load(os.path.join(T, "audiosubtitledata", "audio_subtitle"))
        audio = [{"id": s.get("AudioId"), "character": one_line(s.get("Character", "")),
                  "text": strip_tags((s.get("Subtitles") or [""] * 6)[slot]).strip()} for s in subs]
        assistants = []
        field = {0: "ContentEn", 1: "ContentJp", 2: "ContentTw", 3: "ContentKr", 5: "ContentChs"}[slot]
        for a in load(os.path.join(T, "imdata", "im_assistant_data")):
            assistants.append({"id": a["Id"], "trigger": a.get("Trigger"), "target": a.get("TargetId"),
                               "pages": [strip_tags(p.get(field) or "") for p in a.get("Pages", [])]})
        parts = {
            "im": {"lang": code, "im": im},
            "os": {"lang": code, "os": osv},
            "extra": {"lang": code, "label": label, "oa": oav, "backup": bdv,
                      "audio": audio, "assistants": assistants},
        }
        for name, payload in parts.items():
            path = os.path.join(OUT, f"content.{code}.{name}.json")
            json.dump(payload, open(path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
            print(f"{code}.{name}", os.path.getsize(path) // 1024, "KB")

    print("index.json", os.path.getsize(os.path.join(OUT, "index.json")) // 1024, "KB")

def _count_replies(node):
    for r in node.get("Replies") or []:
        yield 1
        yield from _count_replies(r)

if __name__ == "__main__":
    main()
