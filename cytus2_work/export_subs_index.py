#!/usr/bin/env python3
"""字幕正文索引：把 media/subs/*.vtt 摊平成 viewer/public/data/subs-index.json

字幕正文只存在于 srtfile_*.ab（导出成 WebVTT），不在文本 JSON 里，所以按正文搜「这句台词属于哪段过场动画」
需要单独索引。

输出结构：
  { "<字幕 key>": { "<lang>": [[start, end, text], ...] } }
"""
import json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
SUBS = os.path.join(HERE, "..", "viewer", "public", "media", "subs")
OUT = os.path.join(HERE, "..", "viewer", "public", "data", "subs-index.json")

TS = re.compile(r"(\d\d):(\d\d):(\d\d)\.(\d{3})")


def secs(text: str) -> float:
    m = TS.match(text.strip())
    if not m:
        return 0.0
    h, mi, s, ms = (int(x) for x in m.groups())
    return round(h * 3600 + mi * 60 + s + ms / 1000, 2)


def parse_vtt(path: str) -> list[list]:
    cues, lines = [], open(path, encoding="utf-8").read().splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        if "-->" in line:
            start, _, end = line.partition("-->")
            body = []
            i += 1
            while i < len(lines) and lines[i].strip():
                body.append(lines[i].strip())
                i += 1
            text = "\n".join(body).replace("<", "\u003c")
            if text:
                cues.append([secs(start), secs(end.split()[0]), text])
        i += 1
    return cues


def main():
    index: dict[str, dict[str, list]] = {}
    for name in sorted(os.listdir(SUBS)):
        if not name.endswith(".vtt"):
            continue
        key, _, lang = name[:-4].partition(".")
        index.setdefault(key, {})[lang] = parse_vtt(os.path.join(SUBS, name))
    json.dump(index, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    total = sum(len(c) for langs in index.values() for c in langs.values())
    print(f"{len(index)} 字幕组 / {total} 条 cue -> {os.path.relpath(OUT, HERE)}")


if __name__ == "__main__":
    main()
