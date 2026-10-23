#!/usr/bin/env python3
"""Export UI logos (song pack icons / brand marks) from the built-in Unity data.

These live in split_base_assets.apk → assets/bin/Data/* (serialized files), not in the
assets/assetpack bundles, so they need their own pass.

Output: viewer/public/media/logos/<name>.png + manifest.json["logos"]
"""
import json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
APK = os.path.join(ROOT, "..", "split_base_assets.apk")
if not os.path.exists(APK):
    APK = os.path.join(ROOT, "..", "cytus2", "split_base_assets.apk")
TMP = os.path.join(ROOT, "media_bundles", "ui")
OUT = os.path.join(ROOT, "..", "viewer", "public", "media")
INDEX = os.path.join(ROOT, "ui_textures.json")

# pack_icon_000..028 + 联名曲包 + 品牌 LOGO
PATTERN = re.compile(
    r"^(pack_icon_\d{3}|capsopack_icon_.+|song_pack_icon|packIcon_preorder|expack\d{3}|"
    r"C2Logo|K4s_2012Logo_White|RayarkLogo_White|Team_Cytus_Logo|Yan-K_Logo_White|rayarkLogoWhite|rayark_logo)$"
)


def main():
    import UnityPy
    from PIL import Image

    if not os.path.exists(INDEX):
        sys.exit(f"缺少 {INDEX}（先运行 scan_ui_textures.py 生成）")
    entries = json.load(open(INDEX, encoding="utf-8"))
    wanted: dict[str, str] = {}
    for file, name, w, h in entries:
        if PATTERN.match(name):
            wanted[name] = file
    print(f"logos to export: {len(wanted)}")

    os.makedirs(TMP, exist_ok=True)
    os.makedirs(os.path.join(OUT, "logos"), exist_ok=True)
    # split_base_assets.apk 把大 .assets 切成 1 MiB 的 .splitN 块，需要按序拼接还原
    listing = subprocess.run(["unzip", "-l", APK], capture_output=True, text=True).stdout
    chunks: dict[str, list[str]] = {}
    for line in listing.splitlines():
        parts = line.split()
        if len(parts) < 4 or "assets/bin/Data/" not in parts[3]:
            continue
        path = parts[3]
        base = path.split(".split", 1)[0]
        if ".split" in path:
            chunks.setdefault(base, []).append(path)
        elif path.endswith(".resource") or path.endswith(".assets"):
            chunks.setdefault(base, [])

    needed_bases = set()
    for file in wanted.values():
        base = "assets/bin/Data/" + file.split(".split", 1)[0]
        needed_bases.add(base)

    for base in sorted(needed_bases):
        out_path = os.path.join(TMP, os.path.basename(base))
        if os.path.exists(out_path):
            continue
        parts = sorted(chunks.get(base, []), key=lambda p: int(p.rsplit(".split", 1)[1] or 0) if ".split" in p else -1)
        if not parts:
            subprocess.run(["unzip", "-o", "-q", "-j", APK, base, "-d", TMP], capture_output=True)
            continue
        with open(out_path, "wb") as fh:
            for part in parts:
                blob = subprocess.run(["unzip", "-p", APK, part], capture_output=True).stdout
                fh.write(blob)
        res = base + ".resource"
        if os.path.exists(os.path.join(TMP, os.path.basename(res))):
            continue
        subprocess.run(["unzip", "-o", "-q", "-j", APK, res, "-d", TMP], capture_output=True)
    print(f"rebuilt {len(needed_bases)} assets files")

    logos: dict[str, dict] = {}
    loaded = {}
    for obj in UnityPy.load(TMP).objects:
        if obj.type.name != "Texture2D":
            continue
        d = obj.read_typetree()
        if d["m_Name"] in wanted:
            loaded[d["m_Name"]] = obj
    for name in sorted(wanted):
        obj = loaded.get(name)
        if obj is None:
            print(f"  missing {name}")
            continue
        img = obj.read().image.convert("RGBA")
        rel = f"logos/{name}.png"
        img.save(os.path.join(OUT, rel), optimize=True)
        logos[name] = {
            "file": rel,
            "w": img.width,
            "h": img.height,
            "bundle": "split_base_assets/bin/Data",
        }
    manifest_path = os.path.join(OUT, "manifest.json")
    manifest = json.load(open(manifest_path, encoding="utf-8")) if os.path.exists(manifest_path) else {}
    manifest["logos"] = logos
    json.dump(manifest, open(manifest_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"logos: {len(logos)}")


if __name__ == "__main__":
    main()
