#!/usr/bin/env python3
"""Export OA (Oracle Archives) art from the built-in Unity data.

These live in split_base_assets.apk → assets/bin/Data/* as UI textures:
  oas_<char>_<objIdx>_<state>   OA 物件面板图（布面 + 符号，3 个状态）
  <char>_objNNN                 OA 物件主图（唱片机等）
  <char>_l                      角色 / 物件 LOGO（白字标志，扫描舞台上显示）

Output: viewer/public/media/oa/<name>.png + manifest.json["oaAssets"]
"""
import json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
APK = os.path.join(ROOT, "..", "split_base_assets.apk")
TMP = os.path.join(ROOT, "media_bundles", "oa")
OUT = os.path.join(ROOT, "..", "viewer", "public", "media")
INDEX = os.path.join(ROOT, "ui_textures.json")

PATTERN = re.compile(r"^(oas_[A-Za-z0-9]+_\d{3}_[123]|[a-z]+\d{3}_obj\d{3}|[a-z]+\d{3}_l)$")


def main():
    import UnityPy

    if not os.path.exists(INDEX):
        sys.exit(f"缺少 {INDEX}（先运行 scan_ui_textures.py）")
    entries = json.load(open(INDEX, encoding="utf-8"))
    wanted: dict[str, str] = {}
    for file, name, w, h in entries:
        if PATTERN.match(name):
            wanted[name] = file
    print(f"oa assets: {len(wanted)}")

    os.makedirs(TMP, exist_ok=True)
    os.makedirs(os.path.join(OUT, "oa"), exist_ok=True)

    listing = subprocess.run(["unzip", "-l", APK], capture_output=True, text=True).stdout
    chunks: dict[str, list[str]] = {}
    for line in listing.splitlines():
        parts = line.split()
        if len(parts) < 4 or "assets/bin/Data/" not in parts[3]:
            continue
        path = parts[3]
        base = path.split(".split", 1)[0]
        chunks.setdefault(base, [])
        if ".split" in path:
            chunks[base].append(path)

    bases = {"assets/bin/Data/" + f.split(".split", 1)[0] for f in wanted.values()}
    for base in sorted(bases):
        out_path = os.path.join(TMP, os.path.basename(base))
        if os.path.exists(out_path):
            continue
        parts = sorted(chunks.get(base, []), key=lambda p: int(p.rsplit(".split", 1)[1]))
        if not parts:
            subprocess.run(["unzip", "-o", "-q", "-j", APK, base, "-d", TMP], capture_output=True)
            continue
        with open(out_path, "wb") as fh:
            for part in parts:
                fh.write(subprocess.run(["unzip", "-p", APK, part], capture_output=True).stdout)
        subprocess.run(
            ["unzip", "-o", "-q", "-j", APK, base + ".resource", "-d", TMP], capture_output=True
        )

    assets = {}
    for obj in UnityPy.load(TMP).objects:
        if obj.type.name != "Texture2D":
            continue
        d = obj.read_typetree()
        if d["m_Name"] not in wanted:
            continue
        img = obj.read().image.convert("RGBA")
        rel = f"oa/{d['m_Name']}.png"
        img.save(os.path.join(OUT, rel), optimize=True)
        assets[d["m_Name"]] = {
            "file": rel,
            "w": img.width,
            "h": img.height,
            "bundle": "split_base_assets/bin/Data",
        }
    manifest_path = os.path.join(OUT, "manifest.json")
    manifest = json.load(open(manifest_path, encoding="utf-8")) if os.path.exists(manifest_path) else {}
    manifest["oaAssets"] = assets
    json.dump(manifest, open(manifest_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"exported: {len(assets)}")


if __name__ == "__main__":
    main()
