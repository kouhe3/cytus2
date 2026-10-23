#!/usr/bin/env python3
"""结场演出（EndPlay）映射：视频 ← 曲目，来自 Il2CppDumper 的 dump.cs。

游戏里结场动画本身没有音轨：`video_endplay_*` 的 VideoClip 里只有 H.264，声音是同时播放的
曲目（`IEndPlayEvent.EndPlaySongInfo`）。这里把每个 EndPlay 事件的 SONG_ID / VIDEO_ID 常量抓出来，
输出 viewer/public/data/endplay.json：

  { "<视频 id>": [ { "class": "...", "song": "...", "line": 12345 } ] }

曲目音频（song 包）不随 split APK 提供，所以离线播放器只能显示「游戏内配乐」是哪首。
"""
import json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
DUMP = os.path.join(HERE, "il2cppdumper", "dump.cs")
OUT = os.path.join(HERE, "..", "viewer", "public", "data", "endplay.json")


# 触发条件（来自 ll2cpp 反汇编，见 README「结场动画的声音从哪来」）：
#   EndPlayEventFactory._GenerateEvent(0x228C94C) 按 story step 选事件；
#   0_GAMEPLAY_CUTSCENE_2 时读 StoryEnding03{Main,Replay}.IsFirstGamePlayCutsceneHit
#   这个静态 bool 由 Event1.OnEnd(isHitAnyNote) 写入（0x228D508：strb w9(=isHitAnyNote) [static+8]）。
CONDITIONS = {
    "SelectForPaffGameplay": "0_GAMEPLAY_CUTSCENE_1：玩家在这里回应 PAFF（点中音符），OnEnd(isHitAnyNote) 把结果写进 IsFirstGamePlayCutsceneHit",
    "FinalBossStage_1": "0_GAMEPLAY_CUTSCENE_2 阶段，且之前回应过 PAFF（IsFirstGamePlayCutsceneHit = true）",
    "FinalBossStage_2": "0_GAMEPLAY_CUTSCENE_2 阶段，且之前没有回应 PAFF（IsFirstGamePlayCutsceneHit = false）",
    "hos027_bossstage": "StoryHans01EndPlayEvent（Hans 线结场）",
    "taos010_bossstage": "StoryTairitsuBranch01.BranchingEndPlay（Tairitsu 分支 1）",
    "taos019_bossstage": "StoryTairitsuBranch02.BranchingEndPlay（Tairitsu 分支 2）",
}
# 前置过场：Event1.OnEnd(isHitAnyNote) 顺带选 StoryEnding03FinalCutscene01/02
PREREQ = {
    "FinalBossStage_1": "ClickOneNoteForPaffCutscene",
    "FinalBossStage_2": "ClickZeroNoteForPaffCutscene",
}
# 结场结束后的去向：Event2/3 的 OnEnd(isSelectedChoice)（0x228D658 / 0x228D768）
AFTER = {
    "FinalBossStage_1": "选择 → 善终1 eos006.mp4；未选择 → 真结局 true_ending.mp4",
    "FinalBossStage_2": "选择 → 善终2 eos007.mp4；未选择 → 真结局 true_ending.mp4",
}


def main():
    out: dict[str, list] = {}
    cur = None
    for i, line in enumerate(open(DUMP, encoding="utf-8", errors="replace"), 1):
        m = re.match(r"public class ([\w.]+) : IEndPlayEvent", line) or re.match(
            r"public class ([\w.]+) : .*IEndPlayEvent", line
        )
        if m:
            cur = {"class": m.group(1), "song": None, "video": None, "line": i}
            continue
        if cur is not None:
            ms = re.search(r'SONG_ID = "([^"]+)"', line)
            if ms:
                cur["song"] = ms.group(1)
            mv = re.search(r'VIDEO_ID = "([^"]+)"', line)
            if mv:
                cur["video"] = mv.group(1)
            if line.startswith("}"):
                if cur["song"]:
                    video = cur["video"] or cur["song"]
                    cur["condition"] = CONDITIONS.get(cur["song"])
                    cur["after"] = AFTER.get(cur["song"])
                    cur["prereq"] = PREREQ.get(cur["song"])
                    out.setdefault(video, []).append(cur)
                cur = None
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    for video, items in out.items():
        print(video, "←", ", ".join(f'{x["song"]} ({x["class"]})' for x in items))


if __name__ == "__main__":
    main()
