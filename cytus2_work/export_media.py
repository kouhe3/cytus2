#!/usr/bin/env python3
"""Export Cytus II story media (images / videos / audio) out of the AssetBundles.

Output: viewer/public/media/**
  os-attachments/<id>.png     ##image=<id>  (OS 档案插图)
  im-attachments/<id>.png     iM 帖子附件
  videos/<clip>.mp4           ##movie=<id> / cutscenedata 的影片（原始 H.264+AAC 流）
  videos/songselect/<clip>.mp4 角色选曲界面背景（video_songselect_*.ab）
  audio/sound/<name>.mp3      ##sound=<name>（ossounds.ab）
  audio/bgm/<name>.mp3        ##bgm=<name>（osbgms.ab）
  os-avatars/<name>.png       osavatars.ab（OS 聊天记录的发送者头像，Sprite 名 = msgs Avatar）
  os-stickers/<name>.png      osstickers.ab（OS 聊天记录的表情包，Sprite 名 = msgs Image）
  manifest.json               id -> 文件 / 尺寸 / 来源 bundle
                              songSelect: normal / trueEnd 角色选曲媒体
"""
import json, os, re, glob, subprocess, sys, shutil, fnmatch, hashlib

ROOT = os.path.dirname(os.path.abspath(__file__))
# 仓库根目录（含 base.apk / split_*.apk）就是 cytus2_work 的上级
APKC = os.path.join(ROOT, "..")
if not os.path.exists(os.path.join(APKC, "base.apk")):
    APKC = os.path.join(ROOT, "..", "cytus2")
TMP = os.path.join(ROOT, "media_bundles")
OUT = os.path.join(ROOT, "..", "viewer", "public", "media")

PACKS = {
    "1": os.path.join(APKC, "split_assets_pack_1.apk"),
    "2": os.path.join(APKC, "split_assets_pack_2.apk"),
}

GROUPS = {
    "avatars": ["imavatars.ab"],
    "osAvatars": ["osavatars.ab"],
    "osStickers": ["osstickers.ab"],
    "galleryIcons": ["galleryicons.ab"],
    "illustrations": ["illustration_*.ab", "broken_illustration_*.ab"],
    "images": ["osattachments_*.ab", "imattachments_*.ab"],
    "videos": ["video_story_*.ab", "video_trueend_*.ab", "video_endplay_*.ab", "video_oasystem_*.ab"],
    "songselect": ["video_songselect_*.ab"],
    "titles": ["video_title_*.ab"],
    "covers": ["galleryimageviewer.ab"],
    "subtitles": ["srtfile_*.ab"],
    "audio": ["ossounds.ab", "osbgms.ab"],
}

# The true-end song-pack-select scene lists these 14 packs; bobo001 has a
# duplicate video asset but is not in CharacterInfos in this build.
SONG_SELECT_SCENE_ORDER = [
    "paff001", "neko001", "robo001", "ivy001", "vanessa001", "xenon001",
    "conner001", "cherry001", "joe001", "sagar001", "rin001", "paff002",
    "neko002", "robo002",
]

def run(cmd):
    return subprocess.run(cmd, check=True, capture_output=True)

def extract(pattern):
    """Extract a glob pattern from every pack that carries matching bundles."""
    for tag, apk in PACKS.items():
        subprocess.run(
            ["unzip", "-o", "-q", "-j", apk, "assets/assetpack/" + pattern, "-d", TMP],
            capture_output=True,
        )

def bundle_names(pattern):
    out = set()
    for tag in PACKS:
        for line in open(os.path.join(ROOT, f"list{tag}.txt"), encoding="utf-8", errors="ignore"):
            if "assets/assetpack/" not in line:
                continue
            name = line.strip().split("/")[-1]
            if fnmatch.fnmatch(name, pattern):
                out.add(name)
    return sorted(out)

DUMMY_RGB = (6, 11, 74)

def is_dummy(img):
    """The game ships a placeholder texture (dark blue canvas, red DUMMY text)."""
    small = img.convert("RGB")
    total = small.width * small.height
    counts = dict((color, n) for n, color in small.getcolors(maxcolors=1 << 20))
    return counts.get(DUMMY_RGB, 0) / total > 0.6

def render_sprite(env):
    """Return (PIL image, width, height) using the Sprite rect; textures are padded squares."""
    sprites = [o for o in env.objects if o.type.name == "Sprite"]
    if sprites:
        sprite = sprites[0].read()
        img = sprite.image
        return img, img.width, img.height
    tex = next(o for o in env.objects if o.type.name == "Texture2D").read()
    img = tex.image
    return img, tex.m_Width, tex.m_Height

def export_avatars(manifest):
    import UnityPy
    os.makedirs(os.path.join(OUT, "avatars"), exist_ok=True)
    path = os.path.join(TMP, "imavatars.ab")
    avatars = {}
    if os.path.exists(path):
        env = UnityPy.load(path)
        for o in env.objects:
            if o.type.name != "Sprite":
                continue
            sprite = o.read()
            img = sprite.image
            name = sprite.m_Name
            rel = f"avatars/{name}.png"
            img.save(os.path.join(OUT, rel), optimize=True)
            avatars[name] = {"file": rel, "w": img.width, "h": img.height, "bundle": "imavatars"}
    manifest["avatars"] = avatars
    print(f"avatars: {len(avatars)}")

def export_gallery_icons(manifest):
    """galleryicons.ab：备份数据库的角色图标（Sprite 名 = gallerydata/folder 的 AvatarId）。"""
    import UnityPy
    os.makedirs(os.path.join(OUT, "gallery-icons"), exist_ok=True)
    icons = {}
    for name in bundle_names("galleryicons.ab"):
        path = os.path.join(TMP, name)
        if not os.path.exists(path):
            continue
        env = UnityPy.load(path)
        for o in env.objects:
            if o.type.name != "Sprite":
                continue
            sprite = o.read()
            img = sprite.image
            rel = f"gallery-icons/{sprite.m_Name}.png"
            img.save(os.path.join(OUT, rel), optimize=True)
            icons[sprite.m_Name] = {
                "file": rel,
                "w": img.width,
                "h": img.height,
                "bundle": name[:-3],
            }
    manifest["galleryIcons"] = icons
    print(f"galleryIcons: {len(icons)}")

def export_sprite_bundle(manifest, bundle, folder, key):
    """Export a single-sprite bundle: OS chat avatars and the sticker set.

    ``osavatars.ab`` names match the ``msgs`` block's ``Avatar`` ids and
    ``osstickers.ab`` names match its ``Image`` ids, so the SPA can resolve a
    transcript bubble to its icon and sticker without a lookup table.
    """
    import UnityPy
    os.makedirs(os.path.join(OUT, folder), exist_ok=True)
    entries = {}
    path = os.path.join(TMP, bundle)
    if os.path.exists(path):
        env = UnityPy.load(path)
        for o in env.objects:
            if o.type.name != "Sprite":
                continue
            sprite = o.read()
            img = sprite.image
            rel = f"{folder}/{sprite.m_Name}.png"
            img.save(os.path.join(OUT, rel), optimize=True)
            entries[sprite.m_Name] = {
                "file": rel,
                "w": img.width,
                "h": img.height,
                "bundle": bundle[:-3],
            }
    manifest[key] = entries
    print(f"{key}: {len(entries)}")

def export_illustrations(manifest):
    import UnityPy
    os.makedirs(os.path.join(OUT, "illustrations"), exist_ok=True)
    found = {}
    names = []
    for pat in GROUPS["illustrations"]:
        names += bundle_names(pat)
    for i, name in enumerate(names, 1):
        path = os.path.join(TMP, name)
        if not os.path.exists(path):
            continue
        short = name[:-3]
        try:
            env = UnityPy.load(path)
            textures = [o for o in env.objects if o.type.name == "Texture2D"]
            if not textures:
                continue
            pick = None
            for o in textures:
                if o.read_typetree().get("m_Name") == "full_illustration":
                    pick = o
                    break
            pick = pick or textures[0]
            data = pick.read()
            rel = f"illustrations/{short}.png"
            data.image.save(os.path.join(OUT, rel), optimize=True)
            entry = {"file": rel, "w": data.m_Width, "h": data.m_Height, "bundle": short}
            found[short] = entry
            m = re.match(r"(?:broken_)?illustration_(.+)_s(\d{3})$", short)
            if m:
                alias = f"{m.group(1)}_{m.group(2)}"
                found[alias] = entry
                entry.setdefault("aliases", []).append(alias)
        except Exception as e:
            print(f"  illustration FAIL {name}: {type(e).__name__} {e}")
        if i % 20 == 0:
            print(f"  illustrations {i}/{len(names)}")
    manifest["illustrations"] = found
    print(f"illustrations: {len(found)} keys")

SRT_LANGS = {"cn": "zh-Hans", "zh": "zh-Hant", "en": "en", "ja": "ja", "ko": "ko"}


def srt_to_vtt(text):
    """SRT -> WebVTT：去 BOM/序号，时间码逗号改点，跳过空字幕。"""
    text = text.lstrip("\ufeff").replace("\r\n", "\n").replace("\r", "\n")
    blocks = []
    for block in text.strip().split("\n\n"):
        lines = [ln for ln in block.split("\n") if ln.strip()]
        if len(lines) < 2:
            continue
        if re.fullmatch(r"\d+", lines[0].strip()):
            lines = lines[1:]
        if not lines or "-->" not in lines[0]:
            continue
        lines[0] = lines[0].replace(",", ".")
        blocks.append("\n".join(lines))
    return "WEBVTT\n\n" + "\n\n".join(blocks) + "\n" if blocks else None


def export_subtitles(manifest):
    """srtfile_<lang>.ab：过场影片的字幕（TextAsset 名 = <movie>.srt）。"""
    import UnityPy
    os.makedirs(os.path.join(OUT, "subs"), exist_ok=True)
    subs = {}
    for name in bundle_names("srtfile_*.ab"):
        lang = SRT_LANGS.get(name[len("srtfile_"):-3])
        path = os.path.join(TMP, name)
        if not lang or not os.path.exists(path):
            continue
        env = UnityPy.load(path)
        for o in env.objects:
            if o.type.name != "TextAsset":
                continue
            d = o.read_typetree()
            asset = d.get("m_Name", "")
            if not asset.endswith(".srt"):
                continue
            movie = asset[:-4]
            vtt = srt_to_vtt(d.get("m_Script") or "")
            if not vtt:
                continue
            rel = f"subs/{movie}.{lang}.vtt"
            with open(os.path.join(OUT, rel), "w", encoding="utf-8") as fh:
                fh.write(vtt)
            subs.setdefault(movie, {})[lang] = {
                "file": rel,
                "cues": vtt.count("-->"),
            }
    manifest["subtitles"] = subs
    print(f"subtitles: {len(subs)} movies")

def export_covers(manifest):
    """gallerydata Format 3（icon_image）：备份数据库的图，纹理名即 FileLocation。

    贴图是方形画布，但游戏按 gallerydata 的 `Location`（"宽,高"，传给 ImageViewer.SetImage）
    显示，例如 neko 组 2048×1365（3:2）、paff 组 3072×1134（2.71:1），因此这里按该尺寸拉伸输出。
    """
    import UnityPy
    from PIL import Image

    sizes = {}
    gal = os.path.join(ROOT, "text", "gallerydata")
    for path in glob.glob(os.path.join(gal, "*")):
        if os.path.basename(path) == "folder":
            continue
        try:
            items = json.load(open(path, encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(items, list):
            continue
        for it in items:
            if it.get("Format") != 3:
                continue
            loc = (it.get("Location") or "").strip()
            if "," not in loc:
                continue
            try:
                w, h = (int(x) for x in loc.split(",", 1))
            except ValueError:
                continue
            if w > 0 and h > 0:
                sizes[it.get("FileLocation", "")] = (w, h)

    os.makedirs(os.path.join(OUT, "covers"), exist_ok=True)
    covers = {}
    for name in bundle_names("galleryimageviewer.ab"):
        path = os.path.join(TMP, name)
        if not os.path.exists(path):
            continue
        env = UnityPy.load(path)
        for o in env.objects:
            if o.type.name != "Texture2D":
                continue
            d = o.read_typetree()
            key = d["m_Name"]
            img = o.read().image.convert("RGBA")
            size = sizes.get(key)
            if size and size != img.size:
                img = img.resize(size, Image.LANCZOS)
            rel = f"covers/{key}.png"
            img.save(os.path.join(OUT, rel), optimize=True)
            covers[key] = {
                "file": rel,
                "w": img.width,
                "h": img.height,
                "bundle": name[:-3],
            }
    manifest["covers"] = covers
    print(f"covers: {len(covers)}")

def export_images(manifest):
    import UnityPy
    os.makedirs(os.path.join(OUT, "os-attachments"), exist_ok=True)
    os.makedirs(os.path.join(OUT, "im-attachments"), exist_ok=True)
    images = {}
    for i, name in enumerate(bundle_names("osattachments_*.ab") + bundle_names("imattachments_*.ab"), 1):
        path = os.path.join(TMP, name)
        if not os.path.exists(path):
            continue
        kind = "os-attachments" if name.startswith("osattachments_") else "im-attachments"
        key = name.split("_", 1)[1][:-3]
        try:
            env = UnityPy.load(path)
            img, w, h = render_sprite(env)
            rel = f"{kind}/{key}.png"
            img.save(os.path.join(OUT, rel), optimize=True)
            entry = {"file": rel, "w": w, "h": h, "bundle": name[:-3]}
            if is_dummy(img):
                entry["placeholder"] = True
            # sprite rect 只是构图裁剪；原始画布另存一份，wiki 需要完整尺寸时用
            tex = next((o for o in env.objects if o.type.name == "Texture2D"), None)
            if tex is not None:
                raw = tex.read()
                if (raw.m_Width, raw.m_Height) != (w, h):
                    full_rel = f"{kind}/{key}.full.png"
                    raw.image.save(os.path.join(OUT, full_rel), optimize=True)
                    entry["full"] = full_rel
                    entry["fullW"], entry["fullH"] = raw.m_Width, raw.m_Height
            images.setdefault(key, []).append(entry)
        except Exception as e:
            print(f"  image FAIL {name}: {type(e).__name__} {e}")
        if i % 50 == 0:
            print(f"  images {i}")
    manifest["images"] = images
    print(f"images: {len(images)} ids")

def export_videos(manifest):
    import UnityPy
    os.makedirs(os.path.join(OUT, "videos"), exist_ok=True)
    videos, movies = {}, {}
    files = []
    for pat in GROUPS["videos"]:
        files += bundle_names(pat)
    for i, name in enumerate(files, 1):
        path = os.path.join(TMP, name)
        if not os.path.exists(path):
            continue
        try:
            env = UnityPy.load(path)
            clip_obj = next(o for o in env.objects if o.type.name == "VideoClip")
            clip = clip_obj.read_typetree()
            res_name = clip["m_ExternalResources"]["m_Source"].split("/")[-1]
            reader = env.file.files[res_name]
            blob = bytes(reader.bytes)
            off = clip["m_ExternalResources"]["m_Offset"]
            size = clip["m_ExternalResources"]["m_Size"]
            data = blob[off:off + size]
            clip_name = clip.get("m_Name") or name[:-3]
            rel = f"videos/{clip_name}.mp4"
            open(os.path.join(OUT, rel), "wb").write(data)
            entry = {
                "file": rel,
                "w": clip.get("Width"),
                "h": clip.get("Height"),
                "fps": clip.get("m_FrameRate"),
                "frames": clip.get("m_FrameCount"),
                "bundle": name[:-3],
                "bytes": len(data),
            }
            videos[clip_name] = entry
            movies[name[:-3]] = entry
            # video_story_pos0901 -> movie id pos0901
            m = re.match(r"video_story_([a-z]{1,3}os\d{4})$", name[:-3])
            if m:
                movies[m.group(1)] = entry
        except Exception as e:
            print(f"  video FAIL {name}: {type(e).__name__} {e}")
        if i % 20 == 0:
            print(f"  videos {i}/{len(files)}")
    manifest["videos"] = videos
    manifest["movies"] = movies
    print(f"videos: {len(videos)} clips")

def _sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def export_song_select(manifest):
    """Export the character background movies used by the song-select screens.

    `video_songselect_*` are the normal per-pack backgrounds; the true-end
    backgrounds already live in manifest["videos"] under the pack id.  Keep
    both in a dedicated `songSelect` map so the cutscene library is not
    flooded with 36 extra "videos without subtitles".
    """
    import UnityPy
    out_dir = os.path.join(OUT, "videos", "songselect")
    os.makedirs(out_dir, exist_ok=True)
    normal = {}
    for name in bundle_names("video_songselect_*.ab"):
        path = os.path.join(TMP, name)
        if not os.path.exists(path):
            continue
        try:
            env = UnityPy.load(path)
            clip_obj = next(o for o in env.objects if o.type.name == "VideoClip")
            clip = clip_obj.read_typetree()
            resource = clip["m_ExternalResources"]["m_Source"].split("/")[-1]
            blob = bytes(env.file.files[resource].bytes)
            offset = clip["m_ExternalResources"]["m_Offset"]
            size = clip["m_ExternalResources"]["m_Size"]
            data = blob[offset:offset + size]
            clip_name = clip.get("m_Name") or name[:-3]
            rel = f"videos/songselect/{clip_name}.mp4"
            open(os.path.join(OUT, rel), "wb").write(data)
            matched = re.match(
                r"^([a-z]+\d{3})(?:_([a-z0-9]+))?_song_select$", clip_name
            )
            normal[clip_name] = {
                "file": rel,
                "w": clip.get("Width"),
                "h": clip.get("Height"),
                "fps": clip.get("m_FrameRate"),
                "frames": clip.get("m_FrameCount"),
                "bundle": name[:-3],
                "bytes": len(data),
                "pack": matched.group(1) if matched else clip_name,
                "variant": (matched.group(2) if matched and matched.group(2) else "default"),
                "mode": "normal",
            }
        except Exception as error:
            print(f"  songselect FAIL {name}: {type(error).__name__} {error}")

    normal_hashes = {}
    for key, entry in normal.items():
        normal_hashes.setdefault(_sha256(os.path.join(OUT, entry["file"])), []).append(key)
    for keys in normal_hashes.values():
        if len(keys) > 1:
            for key in keys:
                normal[key]["duplicateOf"] = [other for other in keys if other != key]

    true_end = {}
    for key, entry in (manifest.get("videos") or {}).items():
        if not str(entry.get("bundle") or "").startswith("video_trueend_"):
            continue
        item = dict(entry)
        item["mode"] = "trueEnd"
        item["pack"] = key
        item["inSceneList"] = key in SONG_SELECT_SCENE_ORDER
        path = os.path.join(OUT, entry["file"])
        if os.path.exists(path):
            matches = normal_hashes.get(_sha256(path), [])
            if matches:
                item["contentMatches"] = matches
        true_end[key] = item

    true_end_hashes = {}
    for key, entry in true_end.items():
        path = os.path.join(OUT, entry["file"])
        if os.path.exists(path):
            true_end_hashes.setdefault(_sha256(path), []).append(key)
    for keys in true_end_hashes.values():
        if len(keys) > 1:
            for key in keys:
                true_end[key]["duplicateOf"] = [other for other in keys if other != key]

    manifest["songSelect"] = {
        "normal": normal,
        "trueEnd": true_end,
        "sceneOrder": SONG_SELECT_SCENE_ORDER,
    }
    print(
        f"songSelect: {len(normal)} normal clips, "
        f"{len(true_end)} true-end clips"
    )


def export_titles(manifest):
    import UnityPy
    os.makedirs(os.path.join(OUT, "titles"), exist_ok=True)
    titles = {}
    for name in bundle_names("video_title_*.ab"):
        path = os.path.join(TMP, name)
        if not os.path.exists(path):
            continue
        try:
            env = UnityPy.load(path)
            clip_obj = next(o for o in env.objects if o.type.name == "VideoClip")
            clip = clip_obj.read_typetree()
            reader = env.file.files[clip["m_ExternalResources"]["m_Source"].split("/")[-1]]
            blob = bytes(reader.bytes)
            off = clip["m_ExternalResources"]["m_Offset"]
            size = clip["m_ExternalResources"]["m_Size"]
            clip_name = clip.get("m_Name") or name[:-3]
            rel = f"titles/{clip_name}.mp4"
            open(os.path.join(OUT, rel), "wb").write(blob[off:off + size])
            titles[clip_name] = {
                "file": rel,
                "w": clip.get("Width"),
                "h": clip.get("Height"),
                "fps": clip.get("m_FrameRate"),
                "frames": clip.get("m_FrameCount"),
                "bundle": name[:-3],
            }
        except Exception as e:
            print(f"  title FAIL {name}: {type(e).__name__} {e}")
    manifest["titles"] = titles
    print(f"titles: {len(titles)} clips")

def export_audio(manifest):
    import UnityPy
    sound_dir = os.path.join(OUT, "audio", "sound")
    bgm_dir = os.path.join(OUT, "audio", "bgm")
    os.makedirs(sound_dir, exist_ok=True)
    os.makedirs(bgm_dir, exist_ok=True)
    audio = {"sound": {}, "bgm": {}}
    for bundle, kind in (("ossounds.ab", "sound"), ("osbgms.ab", "bgm")):
        path = os.path.join(TMP, bundle)
        if not os.path.exists(path):
            continue
        env = UnityPy.load(path)
        clips = [o for o in env.objects if o.type.name == "AudioClip"]
        for i, o in enumerate(clips, 1):
            try:
                clip = o.read()
                name = clip.m_Name
                samples = clip.samples
                if not samples:
                    continue
                (fname, raw), = samples.items()
                wav = os.path.join(TMP, "_tmp.wav")
                open(wav, "wb").write(raw)
                safe = re.sub(r"[^0-9A-Za-z._ -]", "_", name).strip() or f"clip{i}"
                rel = f"audio/{kind}/{safe}.mp3"
                run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-q:a", "3", os.path.join(OUT, rel)])
                audio[kind][name] = {
                    "file": rel,
                    "seconds": round(float(getattr(clip, "m_Length", 0.0)), 2),
                    "channels": getattr(clip, "m_Channels", None),
                    "hz": getattr(clip, "m_Frequency", None),
                    "bundle": bundle[:-3],
                }
            except Exception as e:
                print(f"  audio FAIL {bundle}: {type(e).__name__} {e}")
            if i % 50 == 0:
                print(f"  {kind} {i}/{len(clips)}")
        print(f"{bundle}: {len(audio[kind])} clips")
    manifest["audio"] = audio

def annotate_audio(manifest):
    """给每段影片标注有无音轨（video_endplay_* / video_oasystem_* 本身只有 H.264，声音由曲目/音效另播）"""
    import subprocess

    def annotate(entry):
        path = os.path.join(OUT, entry["file"])
        if not os.path.exists(path):
            return
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", path],
            capture_output=True, text=True,
        ).stdout
        entry["hasAudio"] = "audio" in out.split()

    for group in ("videos", "titles"):
        for entry in (manifest.get(group) or {}).values():
            annotate(entry)
    song_select = manifest.get("songSelect") or {}
    for section in ("normal", "trueEnd"):
        for entry in (song_select.get(section) or {}).values():
            annotate(entry)
    print("audio flags written")


def main():
    what = sys.argv[1:] or ["images", "videos", "audio"]
    os.makedirs(TMP, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    manifest_path = os.path.join(OUT, "manifest.json")
    manifest = json.load(open(manifest_path, encoding="utf-8")) if os.path.exists(manifest_path) else {}

    for kind in what:
        patterns = GROUPS[kind]
        print(f"== {kind}")
        for pat in patterns:
            extract(pat)
        if kind == "avatars":
            export_avatars(manifest)
        elif kind == "osAvatars":
            export_sprite_bundle(manifest, "osavatars.ab", "os-avatars", "osAvatars")
        elif kind == "osStickers":
            export_sprite_bundle(manifest, "osstickers.ab", "os-stickers", "osStickers")
        elif kind == "illustrations":
            export_illustrations(manifest)
        elif kind == "images":
            export_images(manifest)
        elif kind == "videos":
            export_videos(manifest)
        elif kind == "songselect":
            export_song_select(manifest)
        elif kind == "titles":
            export_titles(manifest)
        elif kind == "covers":
            export_covers(manifest)
        elif kind == "galleryIcons":
            export_gallery_icons(manifest)
        elif kind == "subtitles":
            export_subtitles(manifest)
        elif kind == "audio":
            export_audio(manifest)
    annotate_audio(manifest)
    json.dump(manifest, open(manifest_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("manifest:", {k: len(v) for k, v in manifest.items() if isinstance(v, dict)})

if __name__ == "__main__":
    main()
