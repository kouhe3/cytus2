#!/usr/bin/env python3
"""Render Cytus II story text dumped from AssetBundle TextAssets into readable Markdown.

Inputs : cytus2_work/text/**  (TextAssets dumped from assets/assetpack/*.ab)
Outputs: cytus2_story/**
"""
import json, os, re, shutil, glob, collections

SRC = "text"
OUT = "../cytus2_story"

# Contents / Names / Titles array slot -> language folder
LANGS = [
    (0, "en", "English"),
    (1, "ja", "日本語"),
    (2, "zh-Hant", "繁體中文"),
    (3, "ko", "한국어"),
    (5, "zh-Hans", "简体中文"),
]
TAG_RE = re.compile(r"</?(?:size|color|i|b|u|font_[0-9A-Za-z]+)(?:=[^>]*)?>")

def strip_tags(s: str) -> str:
    return TAG_RE.sub("", s or "")

def load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)

def render_script(text: str) -> str:
    """Turn ##-directive game script into markdown dialogue."""
    out, speaker, mode, buf = [], None, "dialogue", []
    skip_json = False
    def flush():
        nonlocal buf
        if buf:
            out.append("")
            out.append("\n".join(buf))
            buf = []
    for raw in (text or "").split("\n"):
        line = raw.rstrip()
        if skip_json:
            viewer = skip_json
            skip_json = False
            if line.strip().startswith("{"):
                try:
                    img = json.loads(line).get("Image")
                except Exception:
                    img = None
                if img:
                    out[-1] = f"*〔界面 {viewer}：{img}〕*"
                continue
        if line.startswith("##"):
            key, _, val = line[2:].partition("=")
            key, val = key.strip(), val.strip()
            if key == "conversation":
                flush(); speaker = strip_tags(val); mode = "dialogue"
            elif key == "text":
                flush(); speaker = None; mode = "text"
            elif key in ("bgm", "sound", "se", "camera"):
                continue
            elif key == "image":
                flush(); out.append(""); out.append(f"*〔插图 {val}〕*")
            elif key == "movie":
                flush(); out.append(""); out.append(f"*〔影片 {val}〕*")
            elif key == "json":
                flush()
                viewer = val
                out.append("")
                out.append(f"*〔界面 {viewer}〕*")
                skip_json = viewer
            elif key == "mail":
                flush()
                parts = [strip_tags(x) for x in val.split(",")]
                while len(parts) < 3:
                    parts.append("")
                out.append("")
                out.append(f"**〔邮件〕标题：{parts[0]}　发件人：{parts[1]}　收件人：{parts[2]}**")
                mode = "text"; speaker = None
            else:
                flush(); out.append(""); out.append(f"*〔{key}={val}〕*")
            continue
        s = strip_tags(line).strip()
        if not s:
            flush()
            continue
        if mode == "dialogue" and speaker:
            out.append("")
            out.append(f"**{speaker}**：{s}")
        else:
            buf.append(s)
    flush()
    return "\n".join(out).strip("\n")

def safe(name: str) -> str:
    return "".join(c if c.isalnum() or c in "-_." else "_" for c in name)


def main():
    os.makedirs(OUT, exist_ok=True)
    for stale in [code for _, code, _ in LANGS] + ["raw"]:
        p = os.path.join(OUT, stale)
        if os.path.isdir(p):
            shutil.rmtree(p)
    for _, code, _ in LANGS:
        for sub in ("im", "os", "oa", "branching"):
            os.makedirs(os.path.join(OUT, code, sub), exist_ok=True)
    raw = os.path.join(OUT, "raw")
    os.makedirs(os.path.join(raw, "im"), exist_ok=True)
    os.makedirs(os.path.join(raw, "os"), exist_ok=True)
    os.makedirs(os.path.join(raw, "oa"), exist_ok=True)
    os.makedirs(os.path.join(raw, "branching"), exist_ok=True)
    os.makedirs(os.path.join(raw, "srt"), exist_ok=True)
    os.makedirs(os.path.join(raw, "cutscene"), exist_ok=True)
    os.makedirs(os.path.join(raw, "gallery"), exist_ok=True)
    os.makedirs(os.path.join(raw, "meta"), exist_ok=True)

    stats = collections.Counter()

    # ---------- meta ----------
    chapters = load(os.path.join(SRC, "osdata", "chapters"))
    chapter_order = {c["Name"]: c["Id"] for c in chapters}
    chapter_names = {c["Id"]: c["Name"] for c in chapters}
    topics = load(os.path.join(SRC, "imdata", "im_topic_data"))
    meta = load(os.path.join(SRC, "imdata", "im_lock_condition_data"))
    assistants = load(os.path.join(SRC, "imdata", "im_assistant_data"))
    for name, data in (("chapters", chapters), ("im_topic_data", topics),
                       ("im_lock_condition_data", meta), ("im_assistant_data", assistants)):
        json.dump(data, open(os.path.join(raw, "meta", name + ".json"), "w", encoding="utf-8"),
                  ensure_ascii=False, indent=1)

    # ---------- iM ----------
    posts = {}
    for d in sorted(glob.glob(os.path.join(SRC, "imposts_*"))):
        if not os.path.isdir(d):
            continue
        f = os.path.join(d, "posts")
        if not os.path.exists(f):
            continue
        p = load(f)
        posts[p["Id"].upper()] = p
        json.dump(p, open(os.path.join(raw, "im", p["Id"].upper() + ".json"), "w", encoding="utf-8"),
                  ensure_ascii=False, indent=1)

    def render_replies(replies, lang, depth):
        out = []
        for r in replies or []:
            body = (r.get("Contents") or [""] * 6)[lang] if r.get("Contents") else ""
            body = strip_tags(body).strip()
            body = body.replace("\n", "\n" + "  " * depth)
            indent = "  " * depth
            att = f"  〔附件 {', '.join(r['Attachments'])}〕" if r.get("Attachments") else ""
            out.append(f"{indent}- **{strip_tags(r.get('CharacterName',''))}** (`{r.get('AvatarId','')}`)：{body}{att}")
            if r.get("Replies"):
                out.extend(render_replies(r["Replies"], lang, depth + 1))
        return out

    im_index = {code: [] for _, code, _ in LANGS}
    for t in topics:
        tid = t["Id"].upper()
        p = posts.get(tid)
        if not p:
            continue
        stats["im_topics"] += 1
        for lang, code, _ in LANGS:
            title = " ".join(strip_tags((t.get("Titles") or [""] * 6)[lang]).split())
            body = (p.get("Contents") or [""] * 6)[lang]
            att = p.get("Attachments") or []
            lines = [f"# {tid}　{strip_tags(title)}", ""]
            lines.append(f"- 账号：{t.get('CharacterName','')} (`{t.get('AvatarId','')}`)")
            lines.append(f"- 点赞：{t.get('LikeCount',0)}")
            if att:
                lines.append(f"- 附件：{', '.join(att)}")
            charts = t.get("UnlockCharts") or []
            if charts:
                lines.append("- 解锁谱面：" + "、".join(
                    f"{c.get('SongId')}[{c.get('Difficulty')}]" for c in charts))
            lines += ["", "## 正文", "", strip_tags(body).strip(), ""]
            lines += ["## 回复", ""]
            lines += render_replies(p.get("Replies"), lang, 0) or ["（无）"]
            path = os.path.join(OUT, code, "im", tid + ".md")
            open(path, "w", encoding="utf-8").write("\n".join(lines) + "\n")
            im_index[code].append((tid, title, t.get("AvatarId", "")))

    # ---------- OS logs ----------
    os_files = [f for f in sorted(os.listdir(os.path.join(SRC, "osdata")))
                if f not in ("chapters",)]
    os_index = {code: [] for _, code, _ in LANGS}
    for fn in os_files:
        entries = load(os.path.join(SRC, "osdata", fn))
        if not isinstance(entries, list):
            continue
        json.dump(entries, open(os.path.join(raw, "os", fn + ".json"), "w", encoding="utf-8"),
                  ensure_ascii=False, indent=1)
        entries = sorted(entries, key=lambda e: (
            chapter_order.get((e.get("TimelineChapter") or {}).get("Chapter", ""), 99),
            (e.get("TimelineChapter") or {}).get("Index", 0)))
        stats["os_files"] += 1
        for lang, code, _ in LANGS:
            parts = [f"# OS 档案：{fn}", "",
                     f"共 {len(entries)} 条记录。", ""]
            for e in entries:
                ch = (e.get("TimelineChapter") or {})
                name = (e.get("Names") or [""] * 6)[lang]
                parts.append(f"## {e.get('Id')}　{' '.join(strip_tags(name).split())}")
                parts.append("")
                date = " ".join(str(e.get("Date", "")).split())
                info = [f"章节 {ch.get('Chapter','')}", f"日期 {date}",
                        f"分类 {e.get('Category','')}", f"类型 {e.get('Type')}"]
                parts.append("- " + "　|　".join(str(x) for x in info))
                body = (e.get("Contents") or [""] * 6)[lang]
                parts += ["", render_script(body), ""]
                stats["os_entries"] += 1
            open(os.path.join(OUT, code, "os", fn + ".md"), "w", encoding="utf-8").write(
                "\n".join(parts).rstrip() + "\n")
            os_index[code].append((fn, len(entries)))

    # ---------- branching OS ----------
    for fn in sorted(os.listdir(os.path.join(SRC, "branchingosdata"))):
        entries = load(os.path.join(SRC, "branchingosdata", fn))
        json.dump(entries, open(os.path.join(raw, "branching", fn + ".json"), "w", encoding="utf-8"),
                  ensure_ascii=False, indent=1)
        for lang, code, _ in LANGS:
            parts = [f"# 分支 OS 档案：{fn}", ""]
            for e in entries:
                name = (e.get("Names") or [""] * 6)[lang]
                parts += [f"## {e.get('Id')}　{strip_tags(name)}", "",
                          f"- 类型 {e.get('Type')}　|　视图 {e.get('ViewSetting', {}).get('Type') if isinstance(e.get('ViewSetting'), dict) else e.get('ViewSetting')}", ""]
                parts += [render_script((e.get("Contents") or [""] * 6)[lang]), ""]
            open(os.path.join(OUT, code, "branching", fn + ".md"), "w", encoding="utf-8").write(
                "\n".join(parts).rstrip() + "\n")

    # ---------- OA system (Alice etc.) ----------
    oa = load(os.path.join(SRC, "oasystemdata", "oa_system_data"))
    json.dump(oa, open(os.path.join(raw, "oa", "oa_system_data.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    mission_obj = {m.get("MissionId"): m.get("ObjectId") for m in oa.get("Missions", [])}
    objs_by_char = collections.defaultdict(list)
    for o in oa.get("Objects", []):
        objs_by_char[o.get("CharacterId", "")].append(o)
    descs_by_char = collections.defaultdict(list)
    for d in oa.get("Descriptions", []):
        descs_by_char[d.get("CharacterId", "")].append(d)
    docs_by_char = collections.defaultdict(list)
    for d in oa.get("Documents", []):
        docs_by_char[d.get("CharacterId", "")].append(d)
    chars = sorted(set(objs_by_char) | set(descs_by_char) | set(docs_by_char))
    for lang, code, _ in LANGS:
        for ch in chars:
            if not ch:
                continue
            parts = [f"# OA 系统：{ch}", ""]
            for o in objs_by_char.get(ch, []):
                parts += [f"## 物件 {o.get('ObjectId')}　{strip_tags((o.get('Names') or ['']*6)[lang])}", "",
                          strip_tags((o.get('Details') or ['']*6)[lang]), ""]
            for d in sorted(descs_by_char.get(ch, []), key=lambda x: x.get("Id", "")):
                body = (d.get("Contents") or ['']*6)[lang]
                body = re.sub(r"</p>", "\n", body).replace("<p>", "")
                dname = " ".join(strip_tags(d.get("Name", "")).split())
                parts += [f"## 描述 {d.get('Id')}　（{d.get('DescriptionObjectId')}）{dname}", "",
                          strip_tags(body).strip(), ""]
            for d in sorted(docs_by_char.get(ch, []), key=lambda x: x.get("DocumentId", "")):
                obj = mission_obj.get(d.get("MissionId"))
                parts += [f"## 文件 {d.get('DocumentId')}" + (f"（物件 {obj}）" if obj else ""), "",
                          render_script((d.get('Contents') or ['']*6)[lang]), ""]
            path = os.path.join(OUT, code, "oa", safe(ch) + ".md")
            open(path, "w", encoding="utf-8").write("\n".join(parts).rstrip() + "\n")
        stats["oa_files"] = len(chars)

    # ---------- audio subtitles ----------
    subs = load(os.path.join(SRC, "audiosubtitledata", "audio_subtitle"))
    json.dump(subs, open(os.path.join(raw, "meta", "audio_subtitle.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    for lang, code, _ in LANGS:
        parts = ["# 语音字幕", ""]
        for s in subs:
            st = (s.get("Subtitles") or [""] * 6)[lang]
            parts += [f"## {s.get('AudioId')}　{strip_tags(s.get('Character',''))}", "", strip_tags(st), ""]
        open(os.path.join(OUT, code, "audio_subtitles.md"), "w", encoding="utf-8").write(
            "\n".join(parts).rstrip() + "\n")

    # ---------- assistant (iM AI 助手) ----------
    for lang, code, _ in LANGS:
        parts = ["# iM 助手对话", ""]
        for a in assistants:
            parts += [f"## {a['Id']}（触发 {a.get('Trigger')}，目标 {a.get('TargetId')}）", ""]
            for p in a.get("Pages", []):
                field = {0: "ContentEn", 1: "ContentJp", 2: "ContentTw", 3: "ContentKr", 5: "ContentChs"}[lang]
                parts += [strip_tags(p.get(field) or ""), ""]
        open(os.path.join(OUT, code, "assistant.md"), "w", encoding="utf-8").write(
            "\n".join(parts).rstrip() + "\n")

    # ---------- srt ----------
    for lang_file in sorted(os.listdir(os.path.join(SRC, "srtfile_cn"))):
        pass
    for bundle, code in (("srtfile_en", "en"), ("srtfile_ja", "ja"), ("srtfile_zh", "zh-Hant"),
                         ("srtfile_ko", "ko"), ("srtfile_cn", "zh-Hans")):
        d = os.path.join(SRC, bundle)
        if not os.path.isdir(d):
            continue
        for fn in sorted(os.listdir(d)):
            shutil.copy(os.path.join(d, fn), os.path.join(raw, "srt", f"{code}__{fn}"))
            stats["srt_files"] += 1

    # ---------- cutscene / gallery raw ----------
    for fn in sorted(os.listdir(os.path.join(SRC, "cutscenedata"))):
        shutil.copy(os.path.join(SRC, "cutscenedata", fn), os.path.join(raw, "cutscene", fn))
    for fn in sorted(os.listdir(os.path.join(SRC, "gallerydata"))):
        shutil.copy(os.path.join(SRC, "gallerydata", fn), os.path.join(raw, "gallery", fn))

    # ---------- indexes ----------
    for lang, code, label in LANGS:
        lines = [f"# iM 时间线（{label}）", ""]
        for tid, title, av in im_index[code]:
            lines.append(f"- [{tid} {title}](im/{tid}.md)　`{av}`")
        open(os.path.join(OUT, code, "im", "index.md"), "w", encoding="utf-8").write("\n".join(lines) + "\n")

        lines = [f"# OS 档案索引（{label}）", ""]
        for fn, n in os_index[code]:
            lines.append(f"- [{fn}](os/{fn}.md)　{n} 条")
        open(os.path.join(OUT, code, "os", "index.md"), "w", encoding="utf-8").write("\n".join(lines) + "\n")

    json.dump(stats, open(os.path.join(OUT, "stats.json"), "w"), ensure_ascii=False, indent=1)
    print(json.dumps(stats, ensure_ascii=False))

if __name__ == "__main__":
    main()
