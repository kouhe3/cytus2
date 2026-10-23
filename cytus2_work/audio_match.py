#!/usr/bin/env python3
"""音频指纹比对：这段影片/音频的 BGM 是曲库里的哪一首？

波形互相关在 AAC/MP3 重编码后会失效（同源配对也只到 0.2），所以这里用
Shazam 式谱峰哈希 + 时间偏移投票：

  1. STFT(2048/512) → 每帧取最强的若干谱峰 → 组合 (f1, f2, Δt) 哈希
  2. 目标与候选的哈希求交，对 `t_target - t_candidate` 投票
  3. 得分 = 最高票数 / 候选哈希总数（同源 ≈ 1 以上，噪声 < 0.05）

用法：
    python audio_match.py ../viewer/public/media/videos/bos6001.mp4
    python audio_match.py <target> --dirs ../viewer/public/media/audio/endplay
    python audio_match.py <target> --songs          # 连 391 个 songdata 一起比
"""
import argparse, collections, glob, os, subprocess, sys

SR = 8000


def load_wav(path: str):
    import numpy as np

    out = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"],
        capture_output=True,
    ).stdout
    return np.frombuffer(out, dtype="<i2").astype("float32") / 32768.0


def fingerprints(x, nfft=2048, hop=512, fan=6, dt_max=12, fmin=150, fmax=3500):
    import numpy as np

    if len(x) < nfft:
        return {}
    frames = np.lib.stride_tricks.sliding_window_view(x, nfft)[::hop]
    spec = np.abs(np.fft.rfft(frames * np.hanning(nfft), axis=1))
    freqs = np.fft.rfftfreq(nfft, 1 / SR)
    band = (freqs > fmin) & (freqs < fmax)
    spec = spec[:, band]
    fb = np.nonzero(band)[0]
    peaks = []
    for t in range(spec.shape[0]):
        row = spec[t]
        idx = np.argsort(row)[-20:][::-1]
        kept = []
        for i in idx:
            if all(abs(int(fb[i]) - int(fb[j])) > 25 for j in kept):
                kept.append(int(i))
            if len(kept) >= fan:
                break
        peaks.append(sorted(int(fb[i]) for i in kept))
    out = collections.defaultdict(list)
    for t, ps in enumerate(peaks):
        for f1 in ps:
            for dt in range(1, dt_max + 1):
                if t + dt >= len(peaks):
                    break
                for f2 in peaks[t + dt]:
                    out[(f1, f2, dt)].append(t)
    return out


def score(target_fp, cand_fp) -> float:
    """最高票数 / 候选哈希数；同源音频 ≈ 1+，不相关 < 0.05"""
    if not cand_fp:
        return 0.0
    votes = collections.Counter()
    for key, t_target in target_fp.items():
        t_cand = cand_fp.get(key)
        if not t_cand:
            continue
        for a in t_target[:4]:
            for b in t_cand[:4]:
                votes[a - b] += 1
    return round((votes.most_common(1)[0][1] if votes else 0) / len(cand_fp), 3)


def song_clips(apk: str):
    """391 个 songdata_<song>.ab 里的 AudioClip（名称, 单声道 8k PCM）"""
    import UnityPy
    import numpy as np

    here = os.path.dirname(os.path.abspath(__file__))
    tmp = os.path.join(here, "media_bundles")
    listing = subprocess.run(["unzip", "-l", apk], capture_output=True, text=True).stdout
    for line in listing.splitlines():
        full = line.split()[-1] if line.strip() else ""
        if not full.endswith(".ab") or "/songdata_" not in full:
            continue
        name = os.path.basename(full)
        path = os.path.join(tmp, name)
        if not os.path.exists(path):
            subprocess.run(["unzip", "-o", "-q", "-j", apk, full, "-d", tmp], check=True)
        env = UnityPy.load(path)
        clip = next((o.read() for o in env.objects if o.type.name == "AudioClip"), None)
        if clip is None:
            continue
        pcm = np.frombuffer(list(clip.samples.values())[0], dtype="<i2").astype("float32") / 32768.0
        if clip.m_Channels == 2:
            pcm = pcm.reshape(-1, 2).mean(axis=1)
        yield name, pcm[np.arange(0, len(pcm), clip.m_Frequency / SR).astype(np.int64)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("target", help="影片或音频文件")
    ap.add_argument("--dirs", nargs="*", default=["../viewer/public/media/audio/bgm"])
    ap.add_argument("--songs", action="store_true", help="同时比对 songdata_* 曲目")
    ap.add_argument("--apk", default="../split_assets_pack_1.apk")
    ap.add_argument("--top", type=int, default=8)
    args = ap.parse_args()

    target_fp = fingerprints(load_wav(args.target))
    print(f"{os.path.basename(args.target)}: {len(target_fp)} hashes", flush=True)
    rows = []
    for d in args.dirs:
        for p in sorted(glob.glob(os.path.join(d, "*.mp3"))) + sorted(glob.glob(os.path.join(d, "*.ogg"))):
            rows.append((score(target_fp, fingerprints(load_wav(p))), os.path.basename(p)))
    if args.songs:
        for name, mono in song_clips(args.apk):
            rows.append((score(target_fp, fingerprints(mono)), name))
    for s, n in sorted(rows, reverse=True)[: args.top]:
        print(f"{s:6.3f}  {n}")


if __name__ == "__main__":
    main()
