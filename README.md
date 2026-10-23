# Cytus II 剧情数据库（canonical DB）与本地 SPA

从 Cytus II（Android split APK，5.3.0）解包重建剧情数据库（实体 + 边 + 多语言正文），
并用新 SPA 在本地阅读。**本仓库只包含管线、schema、测试与前端源码**：APK、解包产物与
派生数据（`build/`）都在 `.gitignore` 里，必须按下面的步骤在本地生成。

> **阅读入口是 `web/`**：`cd web && pnpm dev`。旧 `viewer/` 已冻结，不再参与构建，
> 也不再产出数据；仅作为实现历史保留（见 §6 与 `viewer/README.md`）。

```
.
├── tools/cytus2db/         canonical DB 构建与 wiki 导出（Python 包）
├── schema/                 手写 JSON Schema（实体 / 边）
├── tests/                  管线验收测试
├── wiki/                   wiki profile 与站点标题快照
├── web/                    Vite + React 本地 SPA（唯一阅读入口）
├── cytus2_work/            APK 解包 / 文本提取 / 逆向辅助脚本（Python）
├── viewer/                 旧阅览器（已冻结，不参与构建、不产出数据）
└── docs/adr/               架构决策
```

## 1. 准备

| 依赖 | 说明 |
|:--|:--|
| Python 3.12+ / uv | canonical DB 构建与 wiki 导出；解包脚本另需 `UnityPy`、`Pillow`，反编译辅助脚本需 `capstone` |
| pnpm + Node 20+ | 本地 SPA（`web/`） |
| ffmpeg | 逆向辅助（音频指纹比对）与旧媒体归档 |
| Il2CppDumper | 产出 `dump.cs` / `script.json` / `stringliteral.json`，供 `il2cpp_probe.py` 使用 |

把游戏数据放到仓库根目录：`base.apk`、`split_assets_pack_1.apk`、`split_assets_pack_2.apk`、
`split_base_assets.apk`、`split_config.arm64_v8a.apk`。脚本默认从**上一级目录**或根目录找 APK。

```bash
uv sync                                    # cytus2db + UnityPy
uv pip install pillow capstone numpy       # 解包 / 反编译 / 音频比对辅助脚本
```

## 2. 管线（按顺序）

```bash
# 2.1 文本：把 assets/assetpack/*.ab 里的 TextAsset 全部 dump 成 cytus2_work/text/**
cd cytus2_work
uv run --project .. python dump_all.py
cd ..

# 2.2 canonical DB：实体 / 边 / SQLite / SPA 投影（全部写到 build/）
uv run python -m cytus2db build --out build/ --input cytus2_work
#   build/db/*.jsonl     实体与 edges.jsonl
#   build/db.sqlite      查询索引（FTS5）
#   build/spa/data.json  SPA 投影（web/ 的唯一数据来源）

# 2.3 wiki 导出与校验（可选）
uv run python -m cytus2db render --out build/wiki --patches
uv run python -m cytus2db verify
```

`--input` 指向解包目录（默认读 `$CYTUS2_WORK`，未设置时用本机解包路径）；
`build/` 完全由管线重建，`--clean` 会先清空 `db/`、`db.sqlite` 与 `spa/`。

## 3. 本地 SPA（`web/`）

```bash
cd web
pnpm install
pnpm dev       # http://127.0.0.1:5190
pnpm typecheck
pnpm build
```

`pnpm dev` 在 `build/spa/data.json` 缺失时会尝试自行跑 `python -m cytus2db build`；
更稳妥的做法是先执行 §2.2。路由、搜索、语言切换与冒烟测试见 `web/README.md`。
SPA 只读 `build/`：不引用 `viewer/`，也不读取 `viewer/public/data/`。

## 4. 逆向辅助

`libil2cpp.so` 这类大库不需要开 IDA 也能问「这个分支为什么走这条路」：

```bash
cd cytus2_work

# 先跑 Il2CppDumper，并把 dump.cs 解析成地址表（一次性）
#   产出 cytus2_work/rva_map.json（不入库）

uv run --project .. python il2cpp_probe.py 0x228D508        # 反汇编 + 解析 adrp/ldr 槽位（TypeInfo / 字符串字面量）
uv run --project .. python il2cpp_probe.py EndPlayEvent2    # 按 dump.cs 方法名找地址

# 「这段影片的 BGM 是哪首」
uv run --project .. python audio_match.py path/to/video.mp4 --songs
```

已用这套方法固化的结论（见 `viewer/README.md` 的「数据与逆向结论」，该文档已归档）：

- 结场动画（`video_endplay_*`）本身无音轨，声音是同时播放的曲目；`songdata_<曲>.ab` 里有 AudioClip；
- 终战 `FinalBossStage_1` / `_2` 由 `IsFirstGamePlayCutsceneHit` 分流——即玩家之前是否**回应过 PAFF**，
  对应前置过场 `ClickOneNoteForPaffCutscene` / `ClickZeroNoteForPaffCutscene`；
- 备份数据库影片条目的 BGM 顺着条件查：`os:<id>` → 该 OS 记录的 `bgm` 块。

## 5. 为什么资产不进库

- APK 约 3.8 GB；导出的媒体约 1.4 GB；剧情文本 JSON 约 17 MB。
- 这些都能由脚本确定性重建，进库只会让仓库失去可维护性。
- 媒体与文本仅用于本地阅读与研究，请自行确认所在地区的合规要求。

## 6. 旧 viewer（冻结）

`viewer/` 是迁移前的 hash 路由阅览器，现已冻结：不再接收功能、数据或文档更新，
不再参与构建，也不再产出数据。它引用的旧数据文件位于 `viewer/public/data/`
（`index.json`、`content.<lang>.{im,os,extra}.json`、`songs.json`、`story-events.json`、
`subs-index.json`、`endplay.json`），由 `cytus2_work/export_*.py` 手动运行生成。
这些文件**不再由 canonical DB 管线写入，也不被 `web/` 读取**，并继续被 `.gitignore` 忽略；
`viewer/public/data/` 不再是任何受支持的构建目标。

旧前端源码与导出脚本仅作历史存档保留；运行它们属于复现旧版，不属于当前管线。
旧版启动方式、数据结构与逆向记录见 `viewer/README.md`。
