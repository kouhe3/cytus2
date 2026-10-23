# Cytus II 剧情复现管线

从 Cytus II（Android split APK，5.3.0）里提取剧情文本与媒体，并跑一个浏览器阅览器。
**本仓库只包含复现脚本与阅览器源码**：APK、提取出的剧情文本（`cytus2_story/`）、媒体
（`viewer/public/media/`）与前端数据（`viewer/public/data/`）都在 `.gitignore` 里，必须按下面的步骤在本地生成。

```
.
├── cytus2_work/            提取 / 校验 / 逆向辅助脚本（Python）
└── viewer/                 Vite + React 阅览器源码（数据与媒体从 public/ 现场生成）
```

## 1. 准备

| 依赖 | 说明 |
|:--|:--|
| Python 3.12+ | `UnityPy`（1.25.x）、`Pillow`；反编译辅助脚本另需 `capstone` |
| ffmpeg | 媒体导出（转码 / 时长探测）与音频指纹比对 |
| pnpm + Node 20+ | 阅览器（`viewer/`） |
| Il2CppDumper | 产出 `dump.cs` / `script.json` / `stringliteral.json`，供 `il2cpp_probe.py` 使用 |

把游戏数据放到仓库根目录：`base.apk`、`split_assets_pack_1.apk`、`split_assets_pack_2.apk`、
`split_base_assets.apk`、`split_config.arm64_v8a.apk`。脚本默认从**上一级目录**或根目录找 APK。

```bash
python -m pip install UnityPy pillow capstone
```

## 2. 管线（按顺序）

```bash
cd cytus2_work

# 2.1 文本：把 assets/assetpack/*.ab 里的 TextAsset 全部 dump 成 cytus2_work/text/**
python dump_all.py

# 2.2 文本 → Markdown 剧情图（剧情图 + 语言目录）
python generate.py
python link.py
python verify.py            # 断言：文本 0 遗漏
python verify_links.py      # 断言：0 死链

# 2.3 媒体（写到 viewer/public/media/）
python export_media.py images videos audio covers galleryIcons subtitles
python export_logos.py            # 曲包 / 品牌 LOGO（bin/Data UI 贴图）
python scan_ui_textures.py        # 生成 ui_textures.json（索引，不入库）
python export_oa_assets.py        # OA 物件面板 / 物件图 / 角色 LOGO（94 张）

# 2.4 前端数据（写到 viewer/public/data/）
python export_json.py             # index.json + content.<lang>.{im,os,extra}.json
python export_subs_index.py       # 字幕正文索引（55 组 / 4718 条 cue）
python export_endplay_map.py      # 结场演出：视频 ← 曲目（读 il2cppdumper/dump.cs）
python export_story_events.py     # 全部剧情事件（Story 类 + Action 常量）→ index.storyEvents
python export_song_catalog.py     # 曲库（sharedassets0 的 song_pack_data）+ 获取方式 → data/songs.json
python export_endplay_audio.py    # 给无声的结场动画配曲目音轨（songdata_<曲> 的 AudioClip）
```

## 3. 阅览器

```bash
cd viewer
pnpm install
pnpm dev          # http://127.0.0.1:5173（或 Vite 分配的下一个端口）
pnpm build
```

四个系统：角色 OS（`os`）、时间线（`timeline`）、OA 系统（`oa`）、备份数据库（`backup`），
外加分支剧情与附录（语音 / 助手 / 过场影片与字幕 / 标题演进 / 立绘 / LOGO）。

渲染约定（详见 `viewer/README.md`）：内联图统一拉伸成 `1.5 × (w/h)`、页签自动换行、
档案正文 1px 蓝边框、暗色为默认。

新的本地 SPA 在 `web/`：读取 `python -m cytus2db build` 生成的投影，一条命令
`cd web && pnpm dev` 启动（详见 `web/README.md`）。旧 `viewer/` 已冻结。

## 4. 逆向辅助

`libil2cpp.so` 这类大库不需要开 IDA 也能问「这个分支为什么走这条路」：

```bash
# 先跑 Il2CppDumper，并把 dump.cs 解析成地址表（一次性）
#   产出 cytus2_work/rva_map.json（不入库）

python il2cpp_probe.py 0x228D508        # 反汇编 + 解析 adrp/ldr 槽位（TypeInfo / 字符串字面量）
python il2cpp_probe.py EndPlayEvent2    # 按 dump.cs 方法名找地址

# 「这段影片的 BGM 是哪首」
python audio_match.py ../viewer/public/media/videos/bos6001.mp4 --songs
```

已用这套方法固化的结论（见 `viewer/README.md`）：

- 结场动画（`video_endplay_*`）本身无音轨，声音是同时播放的曲目；`songdata_<曲>.ab` 里有 AudioClip；
- 终战 `FinalBossStage_1` / `_2` 由 `IsFirstGamePlayCutsceneHit` 分流——即玩家之前是否**回应过 PAFF**，
  对应前置过场 `ClickOneNoteForPaffCutscene` / `ClickZeroNoteForPaffCutscene`；
- 备份数据库影片条目的 BGM 顺着条件查：`os:<id>` → 该 OS 记录的 `bgm` 块。

## 5. 为什么资产不进库

- APK 约 3.8 GB；导出的媒体约 1.4 GB；剧情文本 JSON 约 17 MB。
- 这些都能由脚本确定性重建，进库只会让仓库失去可维护性。
- 媒体与文本仅用于本地阅读与研究，请自行确认所在地区的合规要求。
