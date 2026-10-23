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
# 剧情先后（硬约束）：剧情闸不能越级
STORY_AFTER = {
    "story_ending03_main": {"story_ending02"},
    "story_ending03_good_ending1": {"story_ending03_main"},
    "story_ending03_good_ending2": {"story_ending03_main"},
    "story_ending04_main": {"story_ending03_main"},
}
EXTERNAL_STORIES = {
    "story_cherry02": "需 OS 过场 cpos033（Cherry 线）",
    "story_ending03_good_ending1": "结局 03 善终 1",
    "story_ending03_good_ending2": "结局 03 善终 2",
    "story_ending04_main": "结局 04",
}
# story05 的 _ConditionCheck 恒真，但仍需 R2401 触发；其余结局不再无条件视为已通
ALWAYS = {"story05"}


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
    flt = load("imdata/im_filter_data")
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
        # 剧情链：前置完成后，后续剧情视为可完成（ending03 的触发是 gallery/OS，不是 iM）
        changed = True
        while changed:
            changed = False
            for sid, needs in STORY_AFTER.items():
                if sid not in stories_done and needs <= stories_done:
                    stories_done.add(sid)
                    changed = True
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
        cap_now = caps()
        stages.append({
            "stage": stage,
            # 阶段门槛：三主角（PAFF/NEKO/ROBO）在这一段达到的等级，对应游戏里的 LOCK 点
            "lockLevel": max([level.get(p, 0) for p in ("paff001", "neko001", "robo001")] or [0]),
            "capped": {p: c for p, c in cap_now.items() if c < 10_000},
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
    # ---- 同阶段内的交错顺序：触发帖 → 本阶段活跃账号 → 三主角 → 其余主角 → 其他 ----
    triggers_by_stage = {}
    for i, st in enumerate(stages):
        for tid in st["posts"]:
            if tid in triggers:
                triggers_by_stage.setdefault(i, []).append(tid)

    # 剧情 → 主要账号（用于把「本阶段剧情所属账号」排前）
    STORY_ACCOUNT = {
        "story01_new": "paff", "story03": "paff", "story02": "robo",
        "story_neko02": "neko", "story05": "robo", "story_ending02": "xenon",
        "story04": "neko", "story_cherry02": "cherry",
    }
    MAIN = ["paff", "neko", "robo"]
    OTHER_MAIN = ["ivy", "xenon", "conner", "cherry", "joe"]

    def account_of(avatar: str) -> str:
        return avatar.split("_")[0].lower()

    read_index, seq = {}, 0
    # 账号线程顺序：三主角在前，其余主角次之，"其他"最后；同一主角的帖子连续，内部按等级需求升序
    # 账号线程 = 角色（不是 avatar 前缀）：免费 → 付费 → 支线 → 剧情
    T0 = {"paff001", "neko001", "robo001"}
    TIER_ORDER = [
        ["paff001", "neko001", "robo001", "ivy001", "cherry002", "vanessa001", "bobo001"],
        ["ilka001", "xenon001", "conner001", "cherry001", "joe001", "sagar001", "rin001",
         "paff002", "robo002", "neko002"],
        ["graffj001", "miku001", "ai001", "alice001", "hans001", "kaf001", "amiya001",
         "tairitsu001", "neko003", "paff003"],
    ]
    LANE_OF = {pid: tier * 100 + i for tier, group in enumerate(TIER_ORDER) for i, pid in enumerate(group)}
    PLOT_LANE = 300

    # avatar → 所属账号家族（im_filter_data：PAFF 名下就有 paff_01 + paff_02）
    def _pack_of_avatar(av: str) -> str:
        base, _, num = (av or "").partition("_")
        if num.isdigit():
            cand = f"{base}{int(num):03d}"
            if cand in LANE_OF:
                return cand
        return {"paff": "paff001", "neko": "neko001", "robo": "robo001", "cherry": "cherry001"}.get(base.lower(), "")

    AVATAR_FAMILY = {}
    for item in flt.get("Items") or []:
        fam = _pack_of_avatar(item["DisplayAvatarId"])
        for av in item["FilterAvatarIds"]:
            AVATAR_FAMILY[av] = fam

    def resolve_identity(tid: str) -> str:
        """帖子属于哪个角色曲包：优先 LevelLocks 里非「三主角公共锁」的曲包，其次 avatar 前缀补零"""
        packs = [x["SongPackId"] for x in locks[tid]["LevelLocks"]]
        own = [p for p in packs if p in LANE_OF and p not in T0]
        if own:
            return own[0]
        avatar = (topics.get(tid) or {}).get("AvatarId") or ""
        fam = AVATAR_FAMILY.get(avatar)
        if fam:
            return fam
        return _pack_of_avatar(avatar)

    def lane_of(avatar: str) -> int:
        """兼容旧调用（只按 avatar 猜）"""
        return LANE_OF.get(resolve_identity_by_avatar(avatar), PLOT_LANE)

    def resolve_identity_by_avatar(avatar: str) -> str:
        base, _, num = (avatar or "").partition("_")
        if num and num.isdigit():
            cand = f"{base}{int(num):03d}"
            if cand in LANE_OF:
                return cand
        return {"paff": "paff001", "neko": "neko001", "robo": "robo001", "cherry": "cherry001"}.get(base.lower(), "")

    need = {tid: max([x["Level"] for x in e["LevelLocks"]] or [0]) for tid, e in locks.items()}
    topic_seq = {tid: i for i, tid in enumerate(topics)}   # im_topic_data 的数组顺序

    for i, st in enumerate(stages):
        def key(tid):
            ident = resolve_identity(tid)
            return (LANE_OF.get(ident, PLOT_LANE), need.get(tid, 0))

        # 稳定的组内顺序：先用数据表顺序（locks 的键顺序）排一遍，再按 key 稳定排序
        ordered = sorted(st["posts"], key=lambda tid: topic_seq.get(tid, 10_000))
        ordered.sort(key=key)
        for tid in ordered:
            seq += 1
            read_index[tid] = seq

    # 模型外的帖子（如依赖 OS 过场 cpos033 的 Cherry 线）单独归到 stage 98，按等级需求排序
    blocked_sorted = sorted(
        blocked,
        key=lambda tid: (
            max([x["Level"] for x in locks[tid]["LevelLocks"]] or [0]),
            topic_seq.get(tid, 10_000),
        ),
    )
    blocked_reason = {
        tid: (locks[tid]["StoryLockId"] or locks[tid]["TopicLockId"] or "等级 / 前置未在模型内")
        for tid in blocked
    }
    for tid in blocked_sorted:
        seq += 1
        read_index[tid] = seq

    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    # 把阶段号写回 index.json，前端 iM 列表按它排序
    idx_path = os.path.join(HERE, "..", "viewer", "public", "data", "index.json")
    idx = json.load(open(idx_path, encoding="utf-8"))
    for t in idx["im"]:
        t["stage"] = out["order"].get(t["id"]) or (98 if t["id"] in blocked_reason else 99)
        t["readIndex"] = read_index.get(t["id"], 10_000)
        if t["id"] in blocked_reason:
            t["external"] = blocked_reason[t["id"]]
        t["lane"] = LANE_OF.get(resolve_identity(t["id"]), PLOT_LANE)
        t["lockLevel"] = next(
            (st["lockLevel"] for st in stages if t["id"] in st["posts"]), 0
        )
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
