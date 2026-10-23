#!/usr/bin/env python3
"""全部剧情事件（Story classes）→ viewer/public/data/story-events.json

数据源：Il2CppDumper 的 dump.cs。

剧情分两层：
  * `public (static) class StoryXxx`     —— 带 `const string ID = "<story id>"` 与 STEP_* 步骤常量；
  * `public class StoryXxx...Action`     —— 真正的触发/BOSS/影片常量（TRIGGER_* / BOSS_* / MOVIE_*）。

所以按「类名前缀」把 Action 类并回所属剧情（`StoryRobo01` ← `StoryRobo01Action`、`StoryNeko01BossAction` …），
再合并常量，得到每条剧情：触发（OS / iM 帖 / gallery）、BOSS 关卡、影片、步骤数、触发的 iM 帖。
"""
import json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
DUMP = os.path.join(HERE, "il2cppdumper", "dump.cs")
OUT = os.path.join(HERE, "..", "viewer", "public", "data", "story-events.json")

STRING_KEYS = (
    "TRIGGER_OS_ID", "TRIGGER_TOPIC_ID", "START_TOPIC_ID", "END_TOPIC_ID", "DELETED_TOPIC_ID",
    "TRIGGER_GALLERY_FOLDER_ID", "TRIGGER_GALLERY_FILE_LOCATION",
    "BOSS_STAGE_ID", "BOSS_SONG_ID", "BOSS_SONGPACK_ID",
    "MOVIE_FILE", "CUTSCENE_MOVIE_FILE", "CUTSCENE_FILE_NAME",
)


def parse_classes():
    """返回 {类名: {"consts": {KEY: value}, "steps": [...], "imTopics": [...]}}"""
    classes, cur = {}, None
    for line in open(DUMP, encoding="utf-8", errors="replace"):
        m = re.match(r"public (?:static )?class ([\w.]+)", line)
        if m:
            cur = m.group(1).split(".")[-1]
            classes[cur] = {"consts": {}, "steps": [], "imTopics": set()}
            continue
        if cur is None:
            continue
        if line.strip().startswith("public const"):
            for key in STRING_KEYS:
                v = re.search(rf'{key} = "([^"]*)"', line)
                if v:
                    classes[cur]["consts"].setdefault(key, v.group(1))
            mid = re.search(r'const string ID = "([^"]+)"', line)
            if mid:
                classes[cur]["consts"]["ID"] = mid.group(1)
            st = re.search(r'const string (STEP_[A-Z0-9_]*) = "([^"]+)"', line)
            if st:
                classes[cur]["steps"].append(st.group(2))
        for t in re.findall(r"TOUCH_IM_(?:POST|TOPIC)_([A-Za-z0-9]+)", line):
            classes[cur]["imTopics"].add(t)
        if line.startswith("}"):
            cur = None
    return classes


def main():
    classes = parse_classes()
    events = []
    for name, data in classes.items():
        sid = data["consts"].get("ID")
        if not sid:
            continue
        # 合并同名 Action 类的常量（StoryRobo01 ← StoryRobo01Action / ...BossAction）
        merged = {"consts": dict(data["consts"]), "steps": list(data["steps"]),
                  "imTopics": set(data["imTopics"]), "actions": []}
        for other, od in classes.items():
            if other == name or not other.startswith(name):
                continue
            if not (od["consts"] or od["steps"]):
                continue
            merged["actions"].append(other)
            for k, v in od["consts"].items():
                merged["consts"].setdefault(k, v)
            merged["steps"] += od["steps"]
            merged["imTopics"] |= od["imTopics"]

        info = {"id": sid, "cls": name, "actions": merged["actions"]}
        for key in STRING_KEYS:
            if key in merged["consts"]:
                info[key.lower()] = merged["consts"][key]
        if merged["steps"]:
            info["steps"] = merged["steps"]
        if merged["imTopics"]:
            info["imTopics"] = sorted(merged["imTopics"])
        events.append(info)

    events.sort(key=lambda e: e["id"])
    json.dump(events, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    # 同时写进 index.json，前端 gates 页直接读
    idx_path = os.path.join(HERE, "..", "viewer", "public", "data", "index.json")
    if os.path.exists(idx_path):
        idx = json.load(open(idx_path, encoding="utf-8"))
        idx["storyEvents"] = events
        idx.setdefault("meta", {}).setdefault("counts", {})["gates"] = len(events)
        json.dump(idx, open(idx_path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"{len(events)} 个剧情事件 → {os.path.relpath(OUT, HERE)}")
    for e in events:
        trig = " / ".join(
            f"{k.replace('trigger_', '').replace('_id', '')}={e[k]}"
            for k in ("trigger_os_id", "trigger_topic_id", "start_topic_id", "trigger_gallery_file_location")
            if e.get(k)
        )
        print(f"  {e['id']:32s} boss={e.get('boss_stage_id') or '—':24s} {trig}")


if __name__ == "__main__":
    main()
