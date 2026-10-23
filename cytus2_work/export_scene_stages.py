#!/usr/bin/env python3
"""OA 场景（`*_oa_system.mp4`）的阶段语义：默认 vs 通关后。

游戏里 OA 背景名是 `{prefix}_oa_system.mp4`，`prefix` 默认等于角色 / 曲包 id；
某些剧情 action 结束时会把前缀替换成带造型后缀的版本（`CHANGED_OA_BG_MOVIE_PREFIX`）。
这些常量只出现在剧情 action 类里，直接从 `dump.cs` 解析：

    public class StoryVanessa02Action : ... {
        public const string TRIGGER_OS_ID = "vanessa001";
        public const string TRIGGER_TOPIC_ID = "vos054";
        public const string TRIGGER_SONG_PACK_ID = "vanessa001";
        public const int TRIGGER_SONG_PACK_LEVEL = 35;
        public const string BOSS_STAGE_ID = "vos054_bossstage";
        public const string CHANGED_OA_BG_MOVIE_PREFIX = "vanessa001_s001";   ← 触发后换成它
    }

输出 viewer/public/data/scenes.json：

    { "vanessa001_s001": { "action": "StoryVanessa02Action", "os": "vanessa001",
                           "topic": "vos054", "pack": "vanessa001", "level": "35",
                           "boss": "vos054_bossstage", "movie": "vos5401.mp4" } }
"""
import json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
DUMP = os.path.join(HERE, "il2cppdumper", "dump.cs")
OUT = os.path.join(HERE, "..", "viewer", "public", "data", "scenes.json")

FIELDS = {
    "TRIGGER_OS_ID": "os",
    "TRIGGER_TOPIC_ID": "topic",
    "TRIGGER_SONG_PACK_ID": "pack",
    "TRIGGER_SONG_PACK_LEVEL": "level",
    "BOSS_STAGE_ID": "boss",
    "MOVIE_FILE": "movie",
    "CUTSCENE_MOVIE_FILE": "movie",
}


# 场景前缀的切换条件：来自 `ObjectAnalysisRecord.GetIdByStory`（0x2278214 反编译）
#   vanessa001 : IsStoryEnd("story_vanessa02") → _s001
#   ilka001    : 曲包等级 ≥ 41 → _s002；否则 IsStoryEnd("story_ilka01") → _s001
#   alice001   : 曲包等级 ≥ 21 → _s001
#   hans001    : 曲包等级 ≥ 21 → _s001
#   tairitsu001: 跟随当前造型 GetCurrentCharacterIllustrationId("tairitsu001")
WHEN = {
    "vanessa001_s001": '通关 story_vanessa02（StoryStep.IsStoryEnd）',
    "ilka001_s001": '通关 story_ilka01（且 ilka001 曲包等级 < 41）',
    "ilka001_s002": 'ilka001 曲包等级 ≥ 41',
    "alice001_s001": 'alice001 曲包等级 ≥ 21',
    "hans001_s001": 'hans001 曲包等级 ≥ 21',
    "tairitsu001_s001": '跟随当前造型（GetCurrentCharacterIllustrationId）',
}


def main():
    rows: dict[str, dict] = {}
    consts: dict[str, str] = {}
    cls_name = None

    for line in open(DUMP, encoding="utf-8", errors="replace"):
        m = re.match(r"public class (\w+)", line)
        if m:
            cls_name = m.group(1)
            consts = {}
            continue
        if cls_name is None:
            continue
        if line.strip().startswith("public const"):
            for key, short in FIELDS.items():
                mm = re.search(rf'{key} = "?([^";]+)"?;', line)
                if mm:
                    consts[short] = mm.group(1)
            mm = re.search(r'CHANGED_OA_BG_MOVIE_PREFIX = "([^"]+)"', line)
            if mm:
                rows[mm.group(1)] = {"action": cls_name, **consts}
        if line.startswith("}"):
            cls_name = None

    for prefix, when in WHEN.items():
        rows.setdefault(prefix, {})["when"] = when
    json.dump(rows, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    for prefix, info in rows.items():
        print(prefix, "←", json.dumps(info, ensure_ascii=False))


if __name__ == "__main__":
    main()
