#!/usr/bin/env python3
"""Index every Texture2D name/size in split_base_assets.apk → assets/bin/Data/*.

The game's UI sprites (song pack icons, brand logos, note skins) live in those serialized
files rather than in the asset-pack bundles, so we need a name → file index to find them.

Output: cytus2_work/ui_textures.json  [[file, name, width, height], ...]
Requires the extracted directory cytus2_work/uidata_all (see README).
"""
import json, os, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "uidata_all")
OUT = os.path.join(ROOT, "ui_textures.json")


def main():
    import UnityPy

    if not os.path.isdir(SRC):
        sys.exit(f"缺少 {SRC}（unzip split_base_assets.apk 的 assets/bin/Data/*）")
    names = []
    for i, file in enumerate(sorted(os.listdir(SRC)), 1):
        if file.endswith((".resource", ".txt")):
            continue
        try:
            env = UnityPy.load(os.path.join(SRC, file))
        except Exception:
            continue
        for o in env.objects:
            if o.type.name != "Texture2D":
                continue
            d = o.read_typetree()
            names.append([file, d["m_Name"], d["m_Width"], d["m_Height"]])
        if i % 500 == 0:
            print(f"  {i} files, {len(names)} textures", flush=True)
    json.dump(names, open(OUT, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"textures: {len(names)} → {OUT}")


if __name__ == "__main__":
    main()
