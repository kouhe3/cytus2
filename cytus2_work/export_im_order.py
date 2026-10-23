#!/usr/bin/env python3
"""iM 阅读顺序：按「角色等级 + 剧情 + 帖子依赖」推导，输出 data/im-order.json。

规则来源（都从数据/代码里读，不猜）：
  * `imdata/im_lock_condition_data`：每帖的 `StoryLockId`（需要哪个剧情已通）、`TopicLockId`
    （需要先读哪一帖）、`LevelLocks`（各曲包等级）。`IsLevelLocked = true` 是**硬上限**：
    该等级点同时要求别的角色等级，没达到前该角色升不过这个等级。
  * `imdata/im_topic_data`：帖子解锁的谱面（`UnlockCharts`）—— 打这些谱才涨角色经验。
  * `exptable/exp_data`：每个曲包的等级经验表（用来把「等级」换算成经验，仅用于报告）。
  * `story_triggers.json`：7 个帖子触发剧情（TOUCH_IM_POST_<id>）。
  * dump.cs：`Story*` 类的步骤常量（如 story04 = 触摸 N2201 → story04_1.mp4 → boss）。

模型（贪心 + 不动点）：
  1. 每轮先把各角色等级抬到当前硬上限（上限 = 其它角色等级尚未满足的最小 IsLevelLocked 等级）；
  2. 然后读所有条件满足的帖子（等级 / 前置帖 / 剧情），读到的触发帖把剧情标记为已通；
  3. 重复直到没有新帖可读。每轮记一个 stage。
"""
import json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
T = os.path.join(HERE, "text")
OUT = os.path.join(HERE, "..", "viewer", "public", "data", "im-order.json")

# 由 OS 档案 / 结局触发的剧情（不在 im 触发表里），到达对应阶段后视为已通
OS_STORIES = {
    "story_cherry02": "Cherry 线（OS 触发）",
    "story03": "Ivy 线（OS 触发）",
    "story_ending02": "结局 02",
    "story_ending03_good_ending1": "结局 03 善终 1",
    "story_ending03_good_ending2": "结局 03 善终 2",
    "story_ending04_main": "结局 04",
}


# 旧版开场（StoryOpeningLegacy, ID="story01"）在新版本里默认视为已通，否则 285 个帖子永远锁着
DONE_BY_DEFAULT = {"story01"}

# 剧情可用条件（反编译 `Story*._ConditionCheck`）：
#   story04（StoryNeko01）      neko001 等级 > 23
#   story05（StoryEnding01）    恒真（由 R2401 触发）
#   story_cherry02             需播过 OS 过场 cpos033（Cherry 线，外部）
#   story_ending03_* / ending04 恒真（结局链，外部）
LEVEL_STORY = {"story04": ("neko001", 24)}
EXTERNAL_STORIES = {
    "story_cherry02": "需 OS 过场 cpos033（Cherry 线）",
    "story_ending03_good_ending1": "结局 03 善终 1",
    "story_ending03_good_ending2": "结局 03 善终 2",
    "story_ending04_main": "结局 04",
}
ALWAYS = {"story05", "story_ending03_good_ending1", "story_ending03_good_ending2", "story_ending04_main"}


def derive_triggers():
    """从 dump.cs 的 Story* 类里取 `ID` 与 `TOUCH_IM_POST_/TOUCH_IM_TOPIC_<id>` 步骤常量。

    story_triggers.json 早先是从 metadata 反查的，把 P1201 错挂到 story01；以类定义为准：
      P0101 → story01_new（StoryOpening）
      P1201 → story03（StoryPaff01）
      R0801 / R0901 → story02（StoryRobo01）
      N2201 → story_neko02（StoryNeko02）
      R2401 → story05
      X1601 → story_ending02
    """
    src = open(os.path.join(HERE, "il2cppdumper", "dump.cs"), encoding="utf-8", errors="replace").read()
    out = {}
    for block in re.split(r"\n(?=public (?:static )?class )", src):
        m = re.search(r'const string ID = "([^"]+)"', block)
        if not m:
            continue
        for tid in set(re.findall(r"TOUCH_IM_(?:POST|TOPIC)_([A-Za-z0-9]+)", block)):
            out.setdefault(tid, m.group(1))
    return out


def load(p):
    return json.load(open(os.path.join(T, p), encoding="utf-8"))


def main():
    locks = {e["TopicId"]: e for e in load("imdata/im_lock_condition_data")}
    topics = {t["Id"]: t for t in load("imdata/im_topic_data")}
    triggers = derive_triggers()
    exp = {e["song_pack_id"]: e["table"] for e in load("exptable/exp_data")["exp_table_list"]}

    packs = sorted({x["SongPackId"] for e in locks.values() for x in e["LevelLocks"]})
    level = {p: 0 for p in packs}
    read, stories_done = set(), set(DONE_BY_DEFAULT)
    stages = []

    def caps():
        cap = {p: 10_000 for p in packs}
        for tid, e in locks.items():
            for x in e["LevelLocks"]:
                if not x.get("IsLevelLocked"):
                    continue
                others = {y["SongPackId"]: y["Level"] for y in e["LevelLocks"] if y["SongPackId"] != x["SongPackId"]}
                if all(level[o] >= lv for o, lv in others.items()):
                    continue
                cap[x["SongPackId"]] = min(cap[x["SongPackId"]], x["Level"])
        return cap

    for stage in range(1, 200):
        before = (dict(level), len(read), len(stories_done))
        for p, c in caps().items():
            level[p] = max(level[p], min(c, 99))
        for sid, (pack, need) in LEVEL_STORY.items():
            if level.get(pack, 0) >= need:
                stories_done.add(sid)
        stories_done |= ALWAYS
        newly = []
        changed = True
        while changed:
            changed = False
            for tid, e in locks.items():
                if tid in read:
                    continue
                if e["StoryLockId"] and e["StoryLockId"] not in stories_done:
                    continue
                if e["TopicLockId"] and e["TopicLockId"] not in read:
                    continue
                if any(level[x["SongPackId"]] < x["Level"] for x in e["LevelLocks"]):
                    continue
                read.add(tid)
                newly.append(tid)
                if tid in triggers:
                    stories_done.add(triggers[tid])
                changed = True
        if not newly and (dict(level), len(read), len(stories_done)) == before:
            break
        stages.append({
            "stage": stage,
            "levels": {p: level[p] for p in packs if level[p]},
            "posts": newly,
            "stories": sorted(stories_done),
        })

    blocked = [t for t in locks if t not in read]
    out = {
        "packs": packs,
        "stages": stages,
        "blocked": blocked,
        "order": {tid: i + 1 for i, s in enumerate(stages) for tid in s["posts"]},
        "triggers": triggers,
        "osStories": OS_STORIES,
        "expTables": {p: len(exp.get(p, [])) for p in packs},
    }
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    # 把阶段号写回 index.json，前端 iM 列表按它排序
    idx_path = os.path.join(HERE, "..", "viewer", "public", "data", "index.json")
    idx = json.load(open(idx_path, encoding="utf-8"))
    for t in idx["im"]:
        t["stage"] = out["order"].get(t["id"], 99)
    json.dump(idx, open(idx_path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

    print(f"packs: {packs}")
    for s in stages:
        lv = " ".join(f"{p.replace('001','')}={v}" for p, v in s["levels"].items())
        ev = [f"{t}→{triggers[t]}" for t in s["posts"] if t in triggers]
        print(f"stage {s['stage']:>2}  lv {lv:<46} +{len(s['posts']):>3} 帖" + (f"  剧情: {', '.join(ev)}" if ev else ""))
    print("blocked:", blocked)
    print("total read:", len(read), "/", len(locks))


if __name__ == "__main__":
    main()
