#!/usr/bin/env python3
"""OA 对白（audio_subtitle）→ 语音 + 台词 JSON

数据分两半：
  * 台词：`text/audiosubtitledata/audio_subtitle`，每条 {AudioId, Character, Subtitles[6]}
          （槽位同其他地方：0 en / 1 ja / 2 zh-Hant / 3 ko / 5 zh-Hans）
  * 语音：AudioClip 在 `sharedassets31.assets`（Resources 文件），实际音频流在
          `sharedassets31.resource`，所以要两个都解出来；AudioId 有 `CE0206-1` 这种带后缀的

输出：
  * `viewer/public/media/audio/oa/<AudioId>.ogg`
  * `viewer/public/data/oa-dialogues.json`：按 AudioId 前 4 位分组（CE02 / CE05 …）
"""
import json, os, subprocess, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
APK = os.path.join(HERE, "..", "split_base_assets.apk")
TMP = os.path.join(HERE, "media_bundles")
OUT_JSON = os.path.join(HERE, "..", "viewer", "public", "data", "oa-dialogues.json")
OUT_AUDIO = os.path.join(HERE, "..", "viewer", "public", "media", "audio", "oa")
SUBS = os.path.join(HERE, "text", "audiosubtitledata", "audio_subtitle")

SLOT = {"en": 0, "ja": 1, "zh-Hant": 2, "ko": 3, "zh-Hans": 5}
# 已验证的分组：CE02 = story_ending04_main 的 0_ENDING_SCENE（vos7501 与 vos075_bossstage 之间）
# OA 场景脚本 `SceneCustomizer` 有 8 个语音列表：IntroAudio / Object1~3Audio / PuffAudio /
# VanessaAudio / NoExitAudio / OutroAudio。按顺序与 8 组 CE 对白一一对应（行数与内容都吻合），
# 所以这里补上标签；CE02 组就是 4.0 结局 `0_ENDING_SCENE` 的开场（vos7501 与 vos075_bossstage 之间）。
GROUP_NOTES = {
    "CE02": "OA 空间 · Intro（= story_ending04_main 的 0_ENDING_SCENE 开场）",
    "CE03": "OA 空间 · Object1（唯一幸存者影像）",
    "CE04": "OA 空间 · Object2（建造者核心）",
    "CE05": "OA 空间 · Object3（Violette / 右眼）",
    "CE06": "OA 空间 · Puff",
    "CE07": "OA 空间 · Vanessa",
    "CE08": "OA 空间 · NoExit",
    "CE09": "OA 空间 · Outro",
}


def assemble() -> tuple[str, str]:
    assets = os.path.join(TMP, "sharedassets31.assets")
    resource = os.path.join(TMP, "sharedassets31.resource")
    with zipfile.ZipFile(APK) as z:
        parts = sorted(
            (i for i in z.infolist() if i.filename.startswith("assets/bin/Data/sharedassets31.assets")),
            key=lambda i: i.filename,
        )
        os.makedirs(TMP, exist_ok=True)
        with open(assets, "wb") as fh:
            for p in parts:
                fh.write(z.read(p))
        if not os.path.exists(resource):
            with open(resource, "wb") as fh:
                fh.write(z.read("assets/bin/Data/sharedassets31.resource"))
    return assets, resource


def main():
    import UnityPy

    meta = {m["AudioId"]: m for m in json.load(open(SUBS, encoding="utf-8"))}
    assets, _ = assemble()
    env = UnityPy.load(assets)
    os.makedirs(OUT_AUDIO, exist_ok=True)

    rows = []
    for obj in env.objects:
        if obj.type.name != "AudioClip":
            continue
        clip = obj.read()
        name = clip.m_Name
        m = meta.get(name)
        if not m:
            continue
        samples = clip.samples
        if not samples:
            continue
        wav = samples[list(samples)[0]]
        ogg = os.path.join(OUT_AUDIO, f"{name}.ogg")
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-f", "wav", "-i", "pipe:0", "-c:a", "libvorbis", "-q:a", "4", ogg],
            input=wav,
            check=True,
        )
        rows.append({
            "id": name,
            "group": name[:4],
            "character": m.get("Character") or "",
            "seconds": round(float(clip.m_Length or 0), 2),
            "file": f"audio/oa/{name}.ogg",
            "text": {code: (m.get("Subtitles") or [""] * 6)[i] for code, i in SLOT.items()},
        })

    rows.sort(key=lambda r: (r["group"], r["id"]))
    groups = {}
    for r in rows:
        groups.setdefault(r["group"], {"id": r["group"], "note": GROUP_NOTES.get(r["group"], ""), "lines": []})
        groups[r["group"]]["lines"].append(r)
    data = {"groups": list(groups.values()), "lines": rows}
    json.dump(data, open(OUT_JSON, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"{len(rows)} 条对白 / {len(groups)} 组 → {os.path.relpath(OUT_JSON, HERE)}")


if __name__ == "__main__":
    main()
