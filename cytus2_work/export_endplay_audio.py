#!/usr/bin/env python3
"""给结场动画配乐：`video_endplay_*` 只有画面，声音是同时播放的曲目。

曲目音频其实随 APK 一起发：`songdata_<song>.ab` 里就是一个 AudioClip（Vorbis），
长度与结场视频几乎完全一致（FinalBossStage_1 = 514.8 s vs 视频 516 s）。

做法：视频流原样 copy，只加音轨，输出 `videos/<video>__<song>.mp4`（不改动原无声文件），
并在 manifest.audio 里加 `endplay` 段 + `videoAudio` 索引：

  manifest["videoAudio"]["FinalBossStage|FinalBossStage_1"] = { file, bytes, seconds }

这样终战的两条分支（song 1 / 2）各有一份带音轨的版本，字幕照旧。
"""
import json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
TMP = os.path.join(HERE, "media_bundles")
OUT = os.path.join(ROOT, "viewer", "public", "media")
MANIFEST = os.path.join(OUT, "manifest.json")
ENDPLAY = os.path.join(ROOT, "viewer", "public", "data", "endplay.json")
APKS = [
    os.path.join(ROOT, n)
    for n in ("split_assets_pack_1.apk", "split_assets_pack_2.apk", "split_base_assets.apk", "base.apk")
]


def find_bundle(name: str) -> str | None:
    """在 split APK 里找 songdata 包，解到 media_bundles"""
    local = os.path.join(TMP, name)
    if os.path.exists(local):
        return local
    for apk in APKS:
        if not os.path.exists(apk):
            continue
        out = subprocess.run(["unzip", "-l", apk], capture_output=True, text=True).stdout
        hit = next((l.split()[-1] for l in out.splitlines() if l.strip().endswith("/" + name)), None)
        if hit:
            subprocess.run(["unzip", "-o", "-q", "-j", apk, hit, "-d", TMP], check=True)
            return local
    return None


def extract_clip(path: str, name: str) -> str:
    """AudioClip -> PCM WAV（UnityPy 已经把 Vorbis 解成 16bit PCM，文件名不能当 ogg 用）"""
    import UnityPy

    dst = os.path.join(TMP, f"{name}.wav")
    if os.path.exists(dst):
        return dst
    env = UnityPy.load(path)
    for obj in env.objects:
        if obj.type.name != "AudioClip":
            continue
        clip = obj.read()
        for _, data in clip.samples.items():
            open(dst, "wb").write(data)
            return dst
    sys.exit(f"{path}: 没有 AudioClip")


def mux(video: str, audio: str, out_path: str, seconds: float) -> None:
    cmd = [
        "ffmpeg", "-y", "-v", "error",
        "-i", video,
        "-i", audio,
        "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
        "-af", "apad",
        "-t", f"{seconds:.3f}",
        "-movflags", "+faststart",
        out_path,
    ]
    subprocess.run(cmd, check=True)


def main():
    manifest = json.load(open(MANIFEST, encoding="utf-8"))
    endplay = json.load(open(ENDPLAY, encoding="utf-8"))
    video_audio = manifest.setdefault("videoAudio", {})
    songs = manifest.setdefault("audio", {}).setdefault("endplay", {})
    videos = manifest.get("videos") or {}

    for video_name, items in endplay.items():
        entry = videos.get(video_name) or (manifest.get("movies") or {}).get(video_name)
        if not entry:
            print(f"skip {video_name}: 没有导出的影片")
            continue
        src = os.path.join(OUT, entry["file"])
        seconds = entry.get("seconds") or (entry.get("frames") or 0) / (entry.get("fps") or 30) or 0
        for it in items:
            song = it["song"]
            key = f"{video_name}|{song}"
            rel = f"videos/{video_name}__{song}.mp4"
            dst = os.path.join(OUT, rel)
            bundle = find_bundle(f"songdata_{song.lower()}.ab")
            if not bundle:
                print(f"  {song}: 找不到 songdata 包")
                continue
            clip = extract_clip(bundle, song)
            songs[song] = {"file": f"audio/endplay/{song}.ogg", "bytes": os.path.getsize(clip)}
            os.makedirs(os.path.join(OUT, "audio", "endplay"), exist_ok=True)
            subprocess.run(
                ["ffmpeg", "-y", "-v", "error", "-i", clip, "-c:a", "libvorbis", "-q:a", "6",
                 os.path.join(OUT, songs[song]["file"])],
                check=True,
            )
            if not os.path.exists(dst):
                mux(src, clip, dst, seconds)
            video_audio[key] = {
                "file": rel,
                "bytes": os.path.getsize(dst),
                "seconds": round(seconds, 3),
                "song": song,
                "bundle": f"songdata/{song.lower()}",
            }
            print(f"  {key} -> {rel} ({os.path.getsize(dst) // 1024} KiB)")

    json.dump(manifest, open(MANIFEST, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"videoAudio: {len(video_audio)} · endplay songs: {len(songs)}")


if __name__ == "__main__":
    main()
