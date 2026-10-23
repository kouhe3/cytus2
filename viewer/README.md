# Cytus II 剧情阅览器

把 `cytus2_story/` 里的剧情文本以结构化 JSON 的形式在浏览器里阅读。暗色为默认主题，可切换亮色。

- 技术栈：Vite 8 + React 19 + TypeScript 7（`pnpm init` 起步，无 UI 框架依赖，样式为手写 CSS + CSS 变量令牌）
- 数据：`public/data/index.json`（结构索引）+ 按语言 / 按视图拆分的 `content.<lang>.{im,os,extra}.json`
- 路由：hash 路由（`#/timeline/pos001`、`#/im/P0101`、`#/packs/paff001`），可直接分享链接、支持前进后退

## 运行

```bash
cd viewer
pnpm install
pnpm dev          # http://127.0.0.1:5183
pnpm build        # tsc --noEmit && vite build -> dist/
pnpm preview      # 预览生产构建 http://127.0.0.1:5184
```

数据由 `cytus2_work/export_json.py` 从 `cytus2_work/text/`（AssetBundle 导出的 TextAsset）生成：

```bash
cd cytus2_work && python export_json.py    # 写入 ../viewer/public/data/
```

## 视图

| 视图 | 左侧列表 | 右侧阅读面 |
|:--|:--|:--|
| 时间线 | 三个游戏视图里的两个：**TIMELINE CHAPTER** = 章节列表（17 章）→ 章节内按 **FOLDER**（`TimelineChapter.Folder`，含 `Rin & Sagar`、`Ivy & Vanessa` 这类联合文件夹）分组；**TIMELINE BY VERSION** = 选版本号（默认最新）→ 按 **角色**（osdata 文件名 → `gallerydata/folder` 显示名）分组。两个维度不混用，筛选器也随之切换（章节视图筛文件夹、版本视图筛角色）。游戏里第三个视图「点角色 → 按版本分组」等价于版本视图里先选角色、版本留「全部版本」——此时列表自动改为按版本号分组，无需单独入口 | 档案全文（对话 / 旁白 / 邮件 / 插图 / 影片占位），同文件前后翻页；章节视图里右栏显示章节统计 |
| 等级解锁 | 26 个角色，标题显示角色名（`paff003` → `PΛFF`），编号作为右侧 ID | 每个 level 一行：同一刻解锁的 iM 帖与 OS 条目（可点跳） |
| iM 社群 | 323 帖（游戏内顺序） | 帖子正文 + 嵌套回复 + 剧情闸 + 同 level 的 OS 交叉链接 |
| 结局闸 | 8 个 `StoryLockId` | 该闸解锁的帖子列表 |
| OA 系统 | 12 个角色，列表与页头显示角色名（编号作为 ID） | 物件 / 描述 / 文件（结构化脚本块） |
| 备份数据库 | `gallerydata` 的 25 个角色文件夹 | 每角色影片 / 插图 / Boss 舞台清单（含解锁条件、可直接播放或看大图） |
| 分支剧情 | Tairitsu 线 48 个节点 | 节点正文 + 前驱后继（`LinkedFileIds`） |
| 附录 | 语音字幕 / iM 助手 / 标题画面 / **角色立绘** / **图标与 LOGO** | 对应表格或图片网格（点图下载原图） |

搜索覆盖当前语言的 iM 正文 + OS 全文（标题、ID、章节名、正文），结果按 iM / OS 分组。

## JSON 结构

`index.json`（≈630 KB，首屏一次加载）：

```jsonc
{
  "meta":    { "languages": [{ "code": "zh-Hans", "label": "简体中文" }], "counts": { … } },
  "chapters":[ { "id": 4, "name": "The Lost", "category": 0, "count": 138,
                 "index": [6001, 6138], "date": ["693_06_03 19:14", "702_10_25 …"],
                 "folders": ["…"], "packs": [["cherry001", 29]], "inversions": 43,
                 "entries": ["chos001", "…"] } ],
  "folders": [ { "name": "PAFF", "count": 57, "chapters": ["The Silence"], "entries": […] } ],
  "packs":   [ { "id": "paff001", "levels": [ { "level": 35, "im": ["P…"], "os": ["pos001"] } ] } ],
  "im":      [ { "id": "P0101", "order": 1, "titles": { "zh-Hans": "新曲发表。" },
                 "gate": "story01", "packs": [["paff001", 0]], "charts": […], "replies": 21 } ],
  "os":      [ { "id": "pos001", "file": "paff001", "chapter": "cyTus", "folder": "PAFF",
                 "index": 3006, "date": "693_03_16 14:18", "category": "1.4", "type": 3,
                 "packs": [["paff001", 35]], "fileLock": "", "movies": [] } ],
  "gates":   [ { "id": "story_ending02", "topics": ["O8401", "…"] } ],
  "sync":    [ { "pack": "neko001", "level": 24, "im": ["R2201"], "os": ["chos031"] } ],
  "timeline":[ "ivos002", "vos039", "…" ],          // 世界时间序
  "oa":      [ { "character": "alice001", "objects": […], "documents": […] } ],
  "backup":  [ { "id": "taos001a", "position": 1, "next": ["taos002a"], "branch": "a" } ],
  "titleInfo": [ { "Type": 1, "Name": "Core of cyTus", "Conditions": [ … ] } ]
}
```

内容文件按语言拆分，按需加载（`zh-Hans` 三份合计 ≈5.6 MB）：

```jsonc
// content.zh-Hans.im.json
{ "lang": "zh-Hans",
  "im": { "P0101": { "title": "新曲发表。", "text": "New Song Released.",
                     "replies": [ { "id": "P0102", "author": "iluvpuf", "avatar": "paffsp_01",
                                    "text": "…", "attachments": [], "replies": [] } ] } } }

// content.zh-Hans.os.json
{ "lang": "zh-Hans",
  "os": { "pos001": { "name": "Show_693_03_16", "blocks": [
      { "kind": "dialogue", "speaker": "主持人", "text": "接下来，第 12 号表演者……" },
      { "kind": "narration", "text": "……" },
      { "kind": "image", "id": "pos0101" },
      { "kind": "movie", "id": "pos0901" },
      { "kind": "mail", "title": "…", "from": "…", "to": "…", "body": "…" },
      { "kind": "imageviewer", "id": "pos2401_19201280", "viewer": "imageviewer" },
      { "kind": "note", "directive": "…", "value": "…" } ] } } }

// content.zh-Hans.extra.json
{ "lang": "zh-Hans", "oa": { … }, "backup": { "taos001a": { "blocks": […] } },
  "audio": [ { "id": "CE0202", "character": "PAFF", "text": "…" } ],
  "assistants": [ { "id": "assistant_breakdown", "pages": ["…"] } ] }
```

OS 文本是**块结构**而不是 Markdown：游戏脚本里的 `##conversation` / `##text` / `##image` / `##movie` / `##mail` / `##json` 指令在导出阶段就被拆成 `dialogue` / `narration` / `image` / `movie` / `mail` / `imageviewer` / `note` 七种块，渲染层只负责样式，不再解析文本。

## 媒体（图片 / 影片 / 音频）

`public/media/` 由 `cytus2_work/export_media.py` 从 AssetBundle 导出，`manifest.json` 是 id → 文件的映射：

| 目录 | 来源 | 说明 |
|:--|:--|:--|
| `avatars/` | `imavatars.ab` | 254 个 iM 账户头像（80×80，`AvatarId` → 文件） |
| `gallery-icons/` | `galleryicons.ab` | 31 个备份数据库角色图标（`AvatarId` → 文件；`Avatar` 组件的第二回退） |
| `illustrations/` | `illustration_*.ab`、`broken_illustration_*.ab` | 70 张角色立绘（按造型，如 Default / Kimono / Idol / Concerto）+ 14 张**全灭结局**立绘（`broken_illustration_*`，bad ending 用），均 640×852（`full_illustration` 层） |
| `oa/` | `split_base_assets.apk` → `assets/bin/Data` | 94 张 OA 美术：`oas_<角色>_<物件序号>_<1..3>` 物件面板图（布面 + 符号的 3 个状态，即游戏里物件扫描动画的画面）、`<角色>_objNNN` 物件主图、`<角色>_l` 角色 LOGO（舞台上合成的那种白字标志） |
| `logos/` | `split_base_assets.apk` → `assets/bin/Data` | 52 个曲包 / 联名 / 品牌标志（`pack_icon_000-028`、`capsopack_icon_*`、`RayarkLogo_White`、`C2Logo`…），附录「图标与 LOGO」 |
| `illustrations/` | `illustration_*.ab`、`broken_illustration_*.ab` | 84 个备份数据库插图（640×852，`<char>_<NNN>` 别名映射到 `_s<NNN>` bundle） |
| `os-attachments/` | `osattachments_*.ab` | OS 档案插图（`##image=` / `##json=imageviewer`） |
| `im-attachments/` | `imattachments_*.ab` | iM 帖子附件 |
| `videos/` | `video_{story,trueend,endplay,oasystem}_*.ab` | 116 个 mp4（1111 MB），原始 H.264 + AAC 流，直接切 `VideoClip` 的 `.resource` 段 |
| `titles/` | `video_title_*.ab` | 12 段标题画面动画（1136×852 等，附录「标题画面演进」按 Type 挂载） |
| `covers/` | `galleryimageviewer.ab` | 23 张备份数据库图（Format 3 / `icon_image`）。贴图是方形画布，但游戏按 gallerydata 的 `Location`（`"宽,高"`）拉伸显示，故导出时缩放到该尺寸：neko 组 2048×1365（3:2）、paff 组 3072×1134（2.71:1）、`rayark_10th` 2048×1365 |
| `subs/` | `srtfile_{cn,zh,en,ja,ko}.ab` | 55 部过场影片的字幕，SRT → WebVTT（273 个文件），按语言切换 |
| `audio/sound/` | `ossounds.ab` | `##sound=` 音效（WAV → MP3 VBR） |
| `audio/bgm/` | `osbgms.ab` | `##bgm=` 背景音乐（WAV → MP3 VBR） |

```jsonc
{
  "avatars": { "nekosp_01": { "file": "avatars/nekosp_01.png", "w": 80, "h": 80 } },
  "images": { "aos1101": [ { "file": "os-attachments/aos1101.png", "w": 512, "h": 512, "bundle": "osattachments_aos1101" } ] },
  "videos": { "story04_1": { "file": "videos/story04_1.mp4", "w": 1136, "h": 852, "fps": 24, "frames": 227 } },
  "movies": { "pos0901": { "file": "videos/…mp4" } },          // ##movie=pos0901 → 影片
  "audio":  { "sound": { "Mic_Drop": { "file": "audio/sound/Mic_Drop.mp3", "seconds": 1.2 } },
              "bgm":   { "Node_04": { "…" } } }
}
```

### 内联插图统一尺寸

`components/Media.tsx` 的 `InlineImage` 是所有内联图的唯一入口（iM 附件、OS 档案 `##image` / `##json`、OA 文档、分支剧情静帧）：

```
displayAspect = 1.5 × (贴图宽 / 贴图高)      // 基准框 240×160，拉伸填充，不裁切
width = min(100%, 560px × displayAspect)    // 高度预算 560px，竖图不占满整屏
```

依据 IL2CPP（`ThumbnailButton.SetThumbnail`, RVA 0x21A18F8）：`sizeDelta = (rt.sizeDelta.x * bounds.w/h, rt.sizeDelta.y)`，prefab `ThumbnailButton` 的 RectTransform 为 240×160。实测：512×512 → 1.50，231×512 → 0.68。

### 插图按 Sprite 裁切

AssetBundle 里的 `Texture2D` 往往是**补成正方形**的画布（透明留边），真正的画面由同 bundle 的 `Sprite.m_RD.textureRect` 指定。导出器因此优先取 Sprite 的图像：`taos0101` 的纹理是 512×512，实际插图为 231×512（竖构图），旧版本按纹理直出会得到一张带大片透明的正方形 PNG。清单里的 `w/h` 是裁切后尺寸。

游戏本身也给少数条目发了占位图：分支线 `taos011` / `taos020` / `taos021` 的 9 张插图是深蓝底红字 **DUMMY**，导出器按「≥60% 像素为 `#060B4A`」把它们标成 `placeholder: true`，阅读面在 caption 里注明「占位素材（游戏内为 DUMMY）」。

## 构建产物体积

`pnpm build` 会把 `public/`（`data/` 17 MB + `media/` 1.35 GB）原样复制进 `dist/`，`dist` 约 1.38 GB——媒体是主体。只做本地阅读用 `pnpm dev` 或 `pnpm preview` 即可；要发布到没有媒体目录的静态托管，删掉 `dist/media` 后页面会退回显示资源 id 的占位 chip。

## 兼容性 / 无障碍

- 键盘：`/` 聚焦搜索，`Esc` 清空；所有可点元素都是 `<button>`（列表用 `aria-selected`，导航用 `aria-current`）。
- 主题：`<html data-theme>` 切换，`color-scheme` 同步；默认暗色，选择写入 `localStorage`。
- 响应式：≤900px 单列（导航横向滚动、列表与阅读面上下排列），1440px 双栏。
- 状态：加载中骨架、空列表、搜索无结果、数据缺失错误页均已覆盖。

## 参考

- Vite `public/` 目录与静态资源：[vite.dev/guide/assets](https://vite.dev/guide/assets) — 放在 `public/` 的文件以根绝对路径引用，构建时原样复制到 `dist/`
- React 19 客户端渲染入口：[react.dev/reference/react-dom/client/createRoot](https://react.dev/reference/react-dom/client/createRoot)
- Vite 配置文件与 `defineConfig`：[vite.dev/config/](https://vite.dev/config/)
- `@vitejs/plugin-react` 用法（`plugins: [react()]`）：[npmjs.com/package/@vitejs/plugin-react](https://www.npmjs.com/package/@vitejs/plugin-react)


## 数据与逆向结论（已验证）

以下结论来自 `dump.cs` + `libil2cpp.so` 反汇编（工具：`cytus2_work/il2cpp_probe.py`，或 IDA Pro MCP）。

### 结场动画的音轨

`video_endplay_*` / `video_oasystem_*` 的 VideoClip 只有 H.264，**没有音轨**；声音由同时播放的曲目负责。
`IEndPlayEvent.EndPlaySongInfo` 给出 `SONG_ID`，音频就在 `songdata_<曲目>.ab` 的 AudioClip 里
（例：`FinalBossStage_1` 长 514.8 s，结场影片 516 s）。`export_endplay_audio.py` 以「视频流 copy + 曲目 AAC」合成
`videos/<video>__<song>.mp4`，原无声文件保留。

### 终战两条分支 = 是否回应过 PAFF

`EndPlayEventFactory._GenerateEvent`（0x228C94C）在 step `0_GAMEPLAY_CUTSCENE_2` 读静态 bool
`StoryEnding03{Main,Replay}.IsFirstGamePlayCutsceneHit`（`static_fields + 8`）：

| bool | 前置过场 | 结场曲 | 收尾（`OnEnd(isSelectedChoice)`） |
|:--|:--|:--|:--|
| true（回应过 PAFF） | `ClickOneNoteForPaffCutscene.mp4` | `FinalBossStage_1` | 选择 → 善终1 `eos006`；否则真结局 `true_ending` |
| false（没回应） | `ClickZeroNoteForPaffCutscene.mp4` | `FinalBossStage_2` | 选择 → 善终2 `eos007`；否则真结局 `true_ending` |

这个 bool 由 `StoryEnding03EndPlayEvent1.OnEnd(bool isHitAnyNote)`（0x228D508）写入，随后按它选
`StoryEnding03FinalCutscene01/02`。前置链：gallery `misc/ending03` + OS `vanessa001/vos037` →
BossStage `vanessa_v`（曲 `vanessa001_010`，Hard）→ `IvyDieCutscene.mp4` → `0_VANESSA_EVENT` → 两段 gameplay → 结场。

### OA 描述

- `---` 是**对话分段标记**（游戏内描述一段一段显示），不是台词里的三条杠：`oa_system_data` 的
  `Descriptions[].Contents` 是 `<p>…</p>\n---\n<p>…</p>`，282 个字段（跨语言）带它，`Documents` / `Objects` 没有。
  导出时切成 `lines[]`，`text` 用换行拼接供搜索。
- 同一热点常有 2–3 个变体，阶段由 `EnableCondition` 判定：`OASystemLevelLock` → 初始；
  `OASystemOSLock(pos078)` → Vanessa（恨意）；`OASystemStoryLock(story_ending04_main)` → 4.0 通关后。写成 `stage` / `stageOrder`。
- **描述名只有一份**（繁体中文，如 `NEKO#ΦωΦ\n右側的封鎖線`），`Contents` 才分语言；游戏本身也如此显示，
  页面标 `nameLocked` 并在悬停说明。
- OA 贴图名前缀大小写不统一：`vanessa001` 的是 `oas_Vanessa001_001_*`，其余角色小写；查表用大小写不敏感匹配。

### OA 场景的多版本

影片名 `{prefix}_oa_system.mp4`，`prefix` 由 `ObjectAnalysisRecord.GetIdByStory(songPackId)`（0x2278214）按进度给出；
切换由剧情 action 的 `CHANGED_OA_BG_MOVIE_PREFIX` 常量驱动。多场景角色：

| 角色 | 场景数 | 切换条件 |
|:--|--:|:--|
| `ilka001` | 3 | 初始；`StoryStep.IsStoryEnd("story_ilka01")` → `_s001`；曲包等级 ≥ 41 → `_s002` |
| `vanessa001` | 2 | `IsStoryEnd("story_vanessa02")` → `_s001`（画面从废墟实景变成全息残像） |
| `alice001` | 2 | 曲包等级 ≥ 21 → `_s001` |
| `hans001` | 2 | 曲包等级 ≥ 21 → `_s001` |
| `tairitsu001` | 2 | 跟随当前造型 `GetCurrentCharacterIllustrationId("tairitsu001")` |

其余 8 个角色只有 1 段。`export_scene_stages.py` 解析 `dump.cs` 生成 `data/scenes.json`（含切换条件），
OA「场景」页签在每段视频上方标出「初始（默认场景）/ 变体 · 条件」。

### 备份数据库影片的配乐

影片条目（`format 1`、`icon_video`）名字是游戏内时间码，如 `Video_701_11_29` → `bobo001` 的 `bos6001`，
条件是 `os:bos060` → 该 OS 记录的 `bgm` 块 = `ARC_RIN_AMB`。52 个条目里 18 个能这样查到 BGM。
影片自身也可能带独立音轨：`bos6001.mp4` 的 106 s 音乐不属于任何曲目（`audio_match.py` 对 391 首 songdata +
51 首 osbgms 最高 0.02，同源校准值 1.62），需要人耳辨认时可听 `media/audio/cutscenes/bos6001.mp3`。


### iM 帖子的阅读顺序（按角色等级 / 剧情推导）

依据（均从数据 + 反汇编取，不靠感觉）：

| 来源 | 内容 |
|:--|:--|
| `im_lock_condition_data` | 每帖的 `StoryLockId`（需该剧情已通）、`TopicLockId`（需先读某帖）、`LevelLocks`（各曲包等级）；`IsLevelLocked=true` 是**硬上限** |
| `im_lock_condition.StoryLockId` 判定 | `_IsLockedBySomeStory` = `!StoryStep.IsStoryEnd(id)`（0x237DC44） |
| `im_topic_data.UnlockCharts` | 帖子解锁的谱面 —— 打谱才涨经验，经验表在 `exptable/exp_data` |
| `ILevelLocker`（IMLevelLocker） | 等级上限由 `IsLevelLocked` 条目决定：其它角色没到指定等级前，该角色升不过这个等级 |
| `dump.cs` Story 类 | 触发帖：`P0101→story01_new`、`P1201→story03`、`R0801/R0901→story02`、`N2201→story_neko02`、`R2401→story05`、`X1601→story_ending02`（早先按 metadata 反查把 P1201 错挂成 story01） |
| `Story*._ConditionCheck` | `story04` 需要 `neko001 > 23`；`story_cherry02` 需要播过 OS 过场 `cpos033`；`story01`（StoryOpeningLegacy）/`story05`/`story_ending04_main` 恒真 |

结果（`export_im_order.py`，318/323 帖可排入，5 帖需 Cherry 线 OS 过场）：

| 阶段 | 等级（paff/neko/robo ±其他） | 帖数 | 剧情 |
|--:|:--|--:|:--|
| 1 | 9 / 9 / 9 | 65 | P0101→story01_new、R0801+R0901→story02 |
| 2 | 17 / 17 / 17 | 35 | P1201→story03 |
| 3 | 24 / 24 / 23 | 42 | （neko 24 满足 story04） |
| 4 | 24 / 24 / 29 | 10 | R2401→story05 |
| 5 | 29 / 29 / 29（ivy 24） | 18 | N2201→story_neko02 |
| 6–10 | 34→51 每 3 级一档 | 17+22+11+19+9 | — |
| 11 | 54（ivy 24） | 10 | X1601→story_ending02 |
| 12–14 | 56 / 58 / 74 | 7+13+23 | ivy 79、cherry 24 解锁 |
| 15 | 89 / 79 / 79（cherry 39） | 14 | — |
| 16 | 99 | 3 | — |
| 99 | — | 5 | 需 OS `cpos033`（Cherry 线） |

`index.im[].stage` 写回 `index.json`，iM 列表按它排序，行内显示「阶段 N」。
硬上限互相咬合的例子：`R0801` 要求 paff/neko/robo 同时 9；`N2201` 同时 29；`R2401` 还要 ivy 9；
`Q6101` 要 paff 89 / neko 79 / robo 79 / cherry 39 / ivy 79 / vanessa 49。

### 剧透警告（SpoilerAlert）

`SpoilerAlertTable.ALERT_TABLE`（0x254FFDC 反编译）只有 4 个角色带警告，条件都是「其他角色等级」：

| 角色 | 触发警告的阈值 |
|:--|:--|
| `cherry002` | paff 71 / neko 65 / robo 65 / ivy 38 |
| `ivy001` | paff 24 / neko 24 / robo 23 |
| `vanessa001` | paff 75 / neko 69 / robo 69 |
| `bobo001` | paff 76 / neko 69 / robo 69 / vanessa 24 |

低于阈值时进入该角色内容会先弹 `LevelLockPanelData.PanelTypes.SPOILER_ALERT`（=2）。

### 帖子解锁的谱面

`im_topic_data.UnlockCharts` 是「同一首歌 × 难度」的列表，同一首常有 2–3 档；页面按 `SongId` 聚合成一个 chip：
`paff001_004 · 简单 / 困难`。难度枚举取自 `dump.cs` 的 `Difficulties`：
0 Easy / 1 Hard / 2 Chaos / 3 Glitch / 4 Crash / 5 Dream / 6 Drop。

### iM 账户过滤器

数据来自 `imdata/im_filter_data`，和游戏里一致：一个过滤器图标可以覆盖**多个账号**，其余归「其他」。

| 过滤器 | 覆盖的 avatar | 帖子数 |
|:--|:--|--:|
| PAFF | `paff_01` + `paff_02` | 29 |
| NEKO#ΦωΦ | `neko_01` | 34 |
| ROBO_Head | `robo_01` | 44 |
| Xenon | `xenon_01` | 19 |
| ConneR | `conner_01` | 24 |
| Cherry | `cherry_01` + `cherry_02` | 9 |
| JOE | `joe_01` + `joe_02`（图标 `joe_03`） | 12 |
| 其他 | 不在以上任一组（`default_*` / `team_*` / `misc_*` / 粉丝） | 152 |

`index.json` 里导出为 `imFilters: { items: [{avatar, avatars, name}], otherAvatar, likeAvatar }`；
iM 视图顶部渲染成按钮组（选中即过滤，再点取消），列表仍按阅读阶段排序。
`likeAvatar`（点赞）需要玩家存档状态，暂不提供。

### 游戏内 iM 列表的排序（反编译）

`IMPresenter._GetUnlockedTopicList()` 用一个比较器排序：`IMPresenter.<_GetUnlockedTopicList>b__36_0`（0x2366578），
反编译后就是：

```csharp
(t1, t2) => {
    if (lockStatus(t1) == IMLockStatus.Locked) return 1;    // 锁着的沉底
    if (lockStatus(t2) == IMLockStatus.Locked) return -1;
    return record(t1).Order - record(t2).Order;             // 其余按 Order 升序
}
```

- `IMLockStatus`：`Hidden=0`（不进列表）、`Locked=1`（显示但锁着，排在最后）、`Unlocked=2`。
- `Order` 是**存档字段**（`IMTopicRecord.Order` @0x18），配一个全局 `IMTopicRecordSet.TopicOrderCounter`：
  帖子首次可用时拿一个递增序号，所以列表实际是**按你解锁/首次看到的先后**排列。
- 列表更新后 `IMView.SetTopicList(list, forceNewestTopic)` 会滚到顶部/最新一条；`TopicParam.IsFirstTime` 驱动新帖动画。
- 没有按时间、点赞数、帖子 id 或数据表顺序排序的比较器（`im_topic_data` 本身也没有排序字段）。
- 触发完某个剧情后帖子会被移除（`REMOVE_IM_TOPICS_BY_FINISHING_STORY` / `removeTopicIds`，例如 `N2601`）。

因此本仓库的「阶段排序」是**模拟新档的可达顺序**（等级上限 + 剧情），并不等于某个存档的 `Order`；同一阶段内保持数据顺序。

### iM 阅读顺序（本仓库的设计）

wiki 与游戏都没有给「阅读顺序」——游戏只按你自己的解锁先后（存档 `IMTopicRecord.Order`）排，新档玩家等于自己趟一条路。
这里用「阶段骨架 + 账号线程交错」造一个可复现的顺序（`export_im_order.py`）：

| 键 | 规则 |
|--:|:--|
| 1 | `stage`：等级硬上限 + 剧情节点推出来的 16 段（见上表） |
| 2 | 同阶段内，**触发剧情的帖子优先**（它们开启下一阶段） |
| 3 | 再按账号线程：本阶段「剧情所属账号」→ 其他主角（PAFF/NEKO/ROBO/Ivy/Xenon/ConneR/Cherry/JOE）→ 其他 |
| 4 | 同组内保持数据表顺序（稳定、可复现） |

为什么不做单一全序：323 帖里有 152 帖属于「其他」（粉丝 / 官方 / 杂项），与主线无叙事先后；硬排会制造假精度。
所以列表显示 `#N 阶段 S`，过滤某个账号后仍保持同一套阅读序。

备选方案（未采用）：
- 纯数据表顺序：不反映等级卡点，读者会撞到未解锁的帖子；
- 按游戏存档 Order：需要真实存档，无法在浏览器里复现；
- 按发帖时间/id：数据里根本没有时间字段，id 前缀只反映账号分组。

### iM 阅读顺序 v3：角色等级解锁序 + LOCK 阶段

v2 的「阶段内触发帖优先」会把 `Q4601`（PAFF 的小号）挤到 `R0701` 之后，破坏叙事连贯。
v3 改成按**角色等级解锁顺序**排，LOCK 点就是阶段边界：

| 键 | 规则 |
|--:|:--|
| 1 | `stage`：等级硬上限 + 剧情推出来的 16 段，每段显示三主角达到的等级（`阶段 1（≤Lv9）`、`阶段 2（≤Lv17）`…） |
| 2 | `lane`：账号线程，同一主角的帖子**连续**（PAFF → NEKO → ROBO → Ivy → Xenon → ConneR → Cherry → JOE → 其他）；PAFF 的 `paff_01`/`paff_02`（`P*`/`Q*`）同属一条线 |
| 3 | 该帖的等级需求 `max(LevelLocks[].Level)` 升序 |
| 4 | `im_topic_data` 表顺序兜底 |

说明两点：
- 323 帖里有 208 帖的 `LevelLocks` **不含自己账号的曲包**（例如 Xenon 的帖子被 `paff001`/`neko001` 等级锁住），所以「自身等级」不可得；
  用 `max(LevelLocks[].Level)` 作为解锁进度代理，对同一条线程等于解锁顺序（因为同角色帖子的门槛单调）。
- 玩家实际上同时给所有已解锁、不涉及剧透的角色升级，所以「阶段」内各线程并列，顺序只是阅读时的陈列次序。


### iM 阅读顺序 v4：剧情闸是硬约束

v3 还留了个错误：`story_ending03_good_ending1` 的帖子（`Q46xx` 这批「封锁线」小号）被当成「结局恒真」直接放进了第 1 阶段，
排到 `P0201` 前面。v4 把结局链补进模型：

```python
STORY_AFTER = {
  "story_ending03_main":         {"story_ending02"},
  "story_ending03_good_ending1": {"story_ending03_main"},
  "story_ending03_good_ending2": {"story_ending03_main"},
  "story_ending04_main":         {"story_ending03_main"},
}
```

效果：`Q4601` 从 #2 挪到 **#250（阶段 12）**，`Q6101`（结局 04）在 #315（阶段 15）；开局仍是 `P0101 → P0201 → …`。

另外按「玩家通常的推进方式」把账号线程顺序改成**免费三主角优先、付费主线在后**（与游戏角色列表一致）：

```
PAFF → NEKO#ΦωΦ → ROBO_Head → Ivy → Crystal PuNK → Vanessa → Bo Bo → Xenon → ConneR → JOE → 其他
```

- 「遇到 LOCK 就去刷别的角色」在模型里就是 `IsLevelLocked` 硬上限：阶段卡住时，只能去升别的曲包；
- 列表里给剧情触发帖加了 `⚑` 前缀（`⚑ #1 · 阶段 1（≤Lv9） · PAFF-Official`），方便发现「该点哪一帖」；
- 剧透警告阈值见上表，达到后对应角色（Ivy/Cherry/Vanessa/Bo Bo）的帖子自然进入后续阶段。

### 角色分级（免费 / 付费 / 支线 / 剧情）

按 CyTus Wiki 的角色导航分类，写进 `index.characterTiers`：

| 分级 | 角色（曲包 id） |
|:--|:--|
| **免费**（主线） | `paff001` PAFF、`neko001` NEKO#ΦωΦ、`robo001` ROBO_Head、`ivy001` Ivy、`cherry002` Crystal PuNK、`vanessa001` Vanessa、`bobo001` Bo Bo |
| **付费**（主线） | `ilka001` Ilka、`xenon001` Xenon、`conner001` ConneR、`cherry001` Cherry、`joe001` JOE、`sagar001` Sagar、`rin001` Rin、`paff002` Aroma、`robo002` Nora、`neko002` Neko |
| **支线**（DLC 联动） | `graffj001` Graff.J、`miku001` Miku、`ai001` Kizuna AI、`alice001` Alice、`hans001` Hans、`kaf001` Kaf、`amiya001` Amiya、`tairitsu001` Tairitsu、`neko003` NEKO_II、`paff003` PΛFF |
| **剧情** | 其它出现在剧情里的角色（如 `misc`） |

页面上：`曲包阶级` 与 `备份数据库` 的列表行在副标题前加分级，`曲包` / `OA` 页标题右侧显示分级 chip。
「免费」这 7 个正好就是 iM 账户过滤器里的 7 个图标 —— 与游戏里免费角色的划分一致。

### iM 线程归属：按「角色」而不是 avatar 前缀

`Q68xx`（被 `paff003` 等级锁住）原本因为作者是 `paff_02`/`paff_01` 被塞进 PAFF（免费）线程的最前面 —— 但 PΛFF 是**支线角色**。
v5 的归属解析顺序：

1. `LevelLocks` 里**非三主角公共锁**（不在 `paff001/neko001/robo001`）的曲包 → 直接判定角色（`Q68xx` → `paff003` → 支线）；
2. 否则用 `im_filter_data` 的账号家族（`paff_02` 属于 PAFF 名下，`cherry_02` 属于 Cherry 名下）；
3. 再否则 avatar 前缀补零（`neko_01` → `neko001`）；
4. 都不匹配 → 「其他」。

线程值 = 分级 × 100 + 组内序号：免费 `0–6`、付费 `100–109`、支线 `200–209`、其他 `300`。
所以 PΛFF 的帖子出现在 #36–#39（付费块之后），而 PAFF 小号 `Q4601` 仍在 PAFF 线程里、只是被剧情推到阶段 12（#250）。

### stage 98 / 99 的含义

- `stage 98`：**模型外的剧情依赖**。帖子本身没问题，只是它等的事件不在 iM 里。当前只有 5 帖：`Q3101–Q3501`，
  `StoryLockId = story_cherry02`，而 `StoryCherry02._ConditionCheck`（0x21D8AC0）检查的是 OS 过场
  `CUTSCENE_PLAYED_cpos033` —— 需要先玩 Cherry 线的 OS 剧情，iM 图里没有这条边。
  它们按等级需求排序后接到队尾（`#319–#323`），行内标 `阶段 98 · 外部：story_cherry02`。
- `stage 99`：兜底值（`out["order"].get(id, 99)`），表示「模型既没排到、也没归类」，正常数据下应为 0 条。

想彻底消掉 98，需要把 OS 侧的事件也纳入图：`cpos033` 是 Cherry 的档案过场，可在 OS 阅读进度里判定。

### v6：假设「OS 一解锁就去读」

模型里原本唯一的缺口是 `story_cherry02`（`Q3101–Q3501`），它的条件在 OS 侧。
按「玩家总是在 OS 解锁后立刻阅读」这个前提，把 OS 并进同一套不动点：

```python
OS_STORY_NEEDS = {"story_cherry02": "cpos033"}

def os_ready(entry_id):
    e = os_index[entry_id]                      # index.os 里的 OS 条目
    return all(level[pack] >= lv for pack, lv in e["packs"])        and (not e["fileLock"] or e["fileLock"] in stories_done)
```

每轮在等级提升后判定：OS 条目的等级/前置满足 → 视为已读 → 它触发的剧情进入「已通」。

效果：**323/323 帖全部进入 16 个阶段**，`stage 98 / 99` 归零；`Q3101`（paff 74 + story_cherry02）落在阶段 14，
`Q3601–Q3901` 等落在阶段 15。列表尾部现在是 `#320 阶段 15`、`#321–#323 阶段 16`。

前提变化时（比如读者会跳过 OS）只需要把 `os_ready` 改成依赖“已读进度”，不动其它逻辑。

### v7：支线（DLC）内容放在主线通关之后

问题：`Q6801`（PΛFF 的内容，`paff003` 锁）只要求 `paff003@1`，在模型里第 1 阶段就可读，
于是它跑到 `P0801`（阶段 2）前面 —— 在 PAFF 分类里看起来像是 PAFF 的帖子顺序被打乱。

修正：给支线线程加**可用性下限**——`story_ending02`（主线结局 02）之前，支线内容不进入可选集合：

```python
if LANE_OF.get(resolve_identity(tid), PLOT_LANE) >= 200 and "story_ending02" not in stories_done:
    continue      # 支线 / DLC：主线通关后才开刷
```

效果：支线帖子的阶段变成 11–15（不再出现在 1–2），`P0801 #36（阶段 2）` 仍在 `Q6801 #146（阶段 11）` 之前；
PAFF 分类里的顺序变成 `#1…P0701 → #36 P0801 → … → #146 Q6801`。全部 323 帖仍在 16 段内，`stage 98/99` 为 0。

这是对「免费主线先玩、付费主线与 DLC 通关后再刷」这条玩家习惯的建模；若某位玩家中途就买了 DLC，
只需把下限从 `story_ending02` 换成「拥有该 DLC」即可。

### `story_ending03_good_ending2` 的依赖（为什么结局帖现在排在最后）

- `StoryEnding03GoodEnding2._ConditionCheck`（0x21DA2E8）反编译是 `return true` —— 它没有自己的等级/条件检查，
  完全由剧情链决定位置；
- 它属于**分支结局**：终战结场 `FinalBossStage` 的 `OnEnd(isSelectedChoice)` 决定去 `eos006`（善终1）
  还是 `eos007`（善终2），而走哪条支线又由更早的 `IsFirstGamePlayCutsceneHit`（是否回应过 PAFF）决定。
  所以「善终1」和「善终2」的帖子是**互斥的两套**，同一周目只会看到其中一套；
- 之前它被排在 `Q2201`（NEKO 66 级，阶段 14）之前，是因为 `story_ending03_main` 在数据里没有等级锁，
  模型一满足 `story_ending02` 就放行。v8 给终战补了等级前沿代理：

```python
STORY_LEVEL_REQ = {"story_ending03_main": {"paff001": 89, "neko001": 79, "robo001": 79}}
```

依据是 `Q6101`（ending04 的帖子）的 LevelLocks：paff 89 / neko 79 / robo 79 / cherry 39 / ivy 79 / vanessa 49 ——
结局链发生在这道门槛之后。

结果：`Q2201 #270（阶段 14）` → `Q4601 #298 / Q4701 #300（善终1，阶段 15）` → `Q5101 #301（善终2，阶段 15）`；
列表对结局帖标出 `分支：善终1 / 善终2 / 结局04`，提示它们互斥。

### 剧情事件总表（`#/gates`）

`export_story_events.py` 解析 `dump.cs`：每个 `Story*` 类的 `const string ID` 就是一条剧情事件，
真正的触发常量在它的 `*Action` 类里，所以按类名前缀合并（`StoryRobo01` ← `StoryRobo01Action`、`StoryNeko01BossAction`…）。

每条记录包含：`id / cls / actions[] / trigger_os_id / trigger_topic_id / start_topic_id / end_topic_id /
trigger_gallery_file_location / boss_stage_id / movie_file / steps[] / imTopics[]`，写进 `index.storyEvents`。

页面：`结局与剧情闸` 列表从 8 行扩到 **43 行**，按「主线节点 / 角色线 / Tairitsu 分支 / 结局」分组，
行内显示 `帖 P1201`、`OS vanessa001`、`BOSS vos054_bossstage`、`锁 N 帖`；点进去是详情页：
类名、Action 类、触发源、BOSS、影片（可直接播放，若已导出）、步骤链、本剧情用到的 iM 帖、以它为前置的 iM 帖。

### v9：全部列表按「解锁顺序」排（等级需求优先）

两个修正：

1. **排序键改为 `(阶段, 等级需求, 账号线程, 数据表顺序)`** —— 之前是「线程优先」，
   于是同一阶段里 NEKO 线的帖子会整体压到「其他」账号（如 `O5401`）前面。
   `O5401`（neko001@35）与 `N2501`（neko001@36）同属阶段 7，现在按等级需求排序：`O5401 #179 → N2501 #181`。
2. **DLC 门槛只作用于支线线程**（200–299），不再误伤「其他」（300）。此前 `O5401`（`misc_41` → 其他）
   被 `story_ending02` 门槛推到阶段 11，才出现「反序」。

现在的键含义：

| 键 | 含义 |
|--:|:--|
| 1 | `stage`：等级硬上限 + 剧情节点（LOCK 阶段） |
| 2 | 该帖的解锁等级 `max(LevelLocks[].Level)` —— 这就是「解锁顺序」 |
| 3 | 同等级时按账号线程：PAFF → NEKO → ROBO → Ivy → Crystal PuNK → Vanessa → Bo Bo → 付费 → 支线 → 其他 |
| 4 | `im_topic_data` 表顺序兜底 |

开局因此变成：`#1 P0101（need 0，PAFF）→ #2 N0101（need 0，NEKO）→ #3 Q5701（need 0，NEKO 小号）→ #4 R0101（need 0，ROBO）→ #5 X0101（need 0，Xenon）…`，
同等级内仍按角色顺序分组。

### v10：解锁成本 = 各条件等级之和

`R3501` 有 3 个条件（`paff001@42 + neko001@42 + robo001@42`），而 `O6201` 只要 `paff001@42`。
之前用 `max(LevelLocks.Level)` 排序，两者都是 42，于是靠线程顺序决胜，`R3501`（ROBO 线，lane 2）跑到 `O6201`（其他，lane 300）前面。

玩家是一次升一个角色的，所以成本应按**总和**算：

```python
cost = sum(x["Level"] for x in LevelLocks)
```

`R3501` = 126，`O6201` = 42 → 现在 `O6201 #203 → R3501 #207`。

排序键最终为：`(stage, cost, lane, 表顺序)`；每个阶段内 `cost` 单调不减（已断言验证）。
`index.im[].cost` 也一并导出，便于核对。

### 列表按阶段分组

iM 列表用 `row.group` 输出 `阶段 N（≤LvX）` 作为分组标题（`ListPane` 本来就会渲染 `group`），共 16 段；
行内不再重复阶段号，改为 `#N · 解锁成本 · 账号 · 回复`，并保留 `⚑`（剧情触发帖）、`外部：`、`分支：` 标记。
过滤某个账号时分组依然生效。

### 可折叠的分组列表

所有带分组的列表（`时间线` 的章节/文件夹、`iM` 的阶段、`剧情事件` 的主线/角色线/结局分支、`分支剧情` 的分支段）共用同一个实现：
`ListPane` 把 `row.group` 渲染成按钮头（`aria-expanded`），点击折叠/展开，右侧显示该组条目数。

- 折叠状态保存在组件状态里（`Set<group>`），切换视图仍保留；
- 折叠只影响列表渲染，不影响搜索与行内跳转；
- 分组标题样式统一为 `.group-title--btn`（caret 旋转 + 计数右对齐）。

### 触发源要按真实归属标注

游戏的 `TRIGGER_TOPIC_ID` 命名并不严格：`StoryHans01Action` 里是 `TRIGGER_TOPIC_ID = "hos027"`，
但 `hos027` 其实是 **OS 档案**（hans001 的第 27 个档案），不是 iM 帖。`StoryVanessa02Action` 的 `vos054`、`vos061` 同理。

所以页面在展示前会用 `sourceOf()` 判定 id 属于 iM 帖 / OS 档案 / gallery 条目，再决定标签：

| 字段 | 标签 |
|:--|:--|
| `TRIGGER_TOPIC_ID` 命中 `index.os` | 触发 OS 档案 |
| 命中 `index.im` | 触发 iM 帖 |
| `TRIGGER_OS_ID` | 角色曲包（`hans001`、`vanessa001` 这类曲包 id，不是文件名） |
| `TRIGGER_GALLERY_FILE_LOCATION` | 触发 gallery（`ending03` 等） |

例：`story_hans01` 现在显示 `触发 OS 档案 hos027` / `角色曲包 hans001` / `BOSS hos027_bossstage`，
列表行是 `OS hos027 · 曲包 hans001 · BOSS hos027_bossstage`。

### 术语：触发源 vs 前置

页面里原来到处写「触发」，分不清方向。现在统一成两种说法：

| 词 | 含义 | 出现位置 |
|:--|:--|:--|
| **触发源 / 读后触发剧情** | 读它（帖 / OS 档案 / gallery 条目）会让这段剧情开始 | iM 帖 chip `⚑ 读后触发剧情：story03`；OS 档案 chip `⚑ 读后触发剧情：story_hans01`；剧情详情字段 `触发源（iM 帖 / OS 档案 / gallery）` |
| **前置剧情 / 需先完成** | 必须先完成这段剧情，该条目才可读 | iM 帖 chip `🗝 前置剧情：story01`；iM facts `前置剧情`；剧情详情小节 `需先完成本剧情的 iM 帖（前置关系）`；gates 列表 `前置（N 帖）` |

剧情详情页顶部有一行常驻说明：
「触发源」= 读它 / 玩它会让这段剧情开始；「前置」= 必须先完成这段剧情，那些条目才可读。
列表里 `⚑ 触发帖 ·` 也直接写明该帖是触发源，而不是它的解锁条件。

### Tairitsu 的「分支 OS」（Branching OS）

Tairitsu 有曲包（`songdata_tairitsu001_001…`、`exp_data` 里也有 `tairitsu001`），但**没有 iM 帖、也没有传统 OS 档案**；
游戏给这个角色单独做了一套 **Branching OS**：`branchingosdata/tairitsu001` 的 48 个节点（`taos001a`…`taos0xxc`）。

节点解锁不是按时间线，而是 `UnlockCondition = { Level, StateId, StateValue }`：

- `Level` = Tairitsu 曲包等级（1–15 级，节点按 1/2/3… 递增出现）；
- `StateId = 0`、`StateValue = 0/1/2` = 分支状态（对应分支 a / b / c）；
- 节点还会 `UnlockedCharts` 解锁谱面（例如 `taos005x` 段解锁 `tairitsu001_006`、`taos010x` 段解锁 `tairitsu001_002`）。

页面上的体现：

| 位置 | 变化 |
|:--|:--|
| `等级解锁` | 27 个角色（新增 `tairitsu001`），该角色没有 iM / OS 两列，改为「分支节点 / 解锁谱面」两列 |
| `分支剧情` | 节点详情显示 `解锁等级 Lv*`、`分支状态 StateId 0 = 0`、关联谱面，并有「等级解锁 · tairitsu001 →」回链 |
| OA | Tairitsu 本来就有 OA 档案（12 个 OA 角色之一） |

### 分支图（Branching OS 的二维布局）

Tairitsu 的 Branching OS 在游戏里是一张二维图，不是列表：横轴是 `ViewSetting.Position`（1–21），纵轴是分支行 `a / b / c`，
连线来自 `ViewSetting.LinkedFileIds`。Wiki 那张 `tos-grid` 就是它的网页复刻（列 2/4/6…、行 1–3、`c-in`/`c-out` 箭头）。

本仓库的 `BranchMap`（`viewer/src/components/BranchMap.tsx`）按同样规则渲染：

| 数据 | 用途 |
|:--|:--|
| `ViewSetting.Position` | 列 x |
| 节点 id 后缀 `a/b/c` | 行 y（0/1/2）；无后缀的收束节点放中间行，同列多个时上下错开 |
| `ViewSetting.LinkedFileIds` | 贝塞尔连线（`taos010 → taos012a/012b/011`、`taos019 → taos020/021` 这类分叉都能看到） |
| `UnlockCondition.Level` / `StateValue` | 方块 tooltip（`taos010 · Lv10 · 分支 收束`） |

分支剧情每个节点页顶部都有这张图（可横向滚动），点方块直接跳转；当前节点用 accent 描边。

### 全局搜索覆盖字幕

顶栏搜索（`/`）此前只查 iM / OS / 分支 / 备份库，台词文本搜不到；现在 `searchRows` 会遍历
`data/subs-index.json`，每组字幕出一条（优先当前语言），结果格式 `字幕 · <组> · m:ss · 台词`，
点进去落到 `#/extras/cutscenes|<组>|<编码词>`，页面自动带词过滤并定位到命中处。

`Ending05_Staffroll` 那组字幕（37 条）是 5.0 片尾的开场旁白：前 132 秒由 `?????` 回顾到 4.0 的事件
（除役事件、建造者復甦、A.R.C. 重启 cyTus），124.5–318.05 秒之间没有台词（制作人员名单段），
最后 318–369.9 秒是收尾对话。它只被 `StoryEnding05MainAction/ReplayAction.StaffrollEndPlay` 引用；
4.0 的片尾是场景 `end04_StaffRoll`（Animator + AudioSource，没有视频）。

### 结场/片尾的音轨

`export_endplay_map.py` 从 `dump.cs` 抓 `IEndPlayEvent` 的常量生成 `data/endplay.json`，`export_endplay_audio.py`
再按 `songdata_<song>.ab` 把 Vorbis 音轨复制进视频。注意事件里有两套字段名：
`SONG_ID`/`VIDEO_ID` 与 `BOSS_SONG_ID`/`BOSS_MOVIE_ID`/`BOSS_STAGE_ID`（5.0 片尾 `StaffrollEndPlay`
只有后者），脚本两套都认；只给 `BOSS_MOVIE_ID` 时曲目名取视频名小写（`Ending05_Staffroll` → `ending05_staffroll`）。

结果：`videos/Ending05_Staffroll.mp4`（原片 6:13，无音轨）＋ `videos/Ending05_Staffroll__ending05_staffroll.mp4`
（H.264 + AAC 6:13）。ending03 的 true ending 片尾 **不是视频**，是场景 `end03_TrueEnd_StaffRoll`，
字母是 UI（`End03TrueEndStaffRollRunner` 逐字母回调），只有它前后的过场是 `true_ending.mp4` /
`good_ending_01.mp4` / `good_ending_02.mp4`。

### 歌曲目录与获取方式

曲名/难度不在 `songdata_*.ab`（那里面只有谱面 JSON 与 AudioClip），而在
`split_base_assets.apk` 的 `assets/bin/Data/sharedassets0.assets`（分片 `.splitN`）里的 TextAsset **`song_pack_data`**：

```json
{"offline_song_pack_list":[{"song_pack_id":"tairitsu001","song_pack_name":"Tairitsu",
  "is_iap_pack":true,"hasIM":false,"price":"$9.99",
  "song_info_list":[{"song_id":"tairitsu001_001","song_name":"Grievous Lady",
                     "artist":"Team Grimoire vs Laur",
                     "charts":{"Easy":{"Level":"6"},"Hard":{"Level":"10"},"Chaos":{"Level":"15+"}}}]}]}
```

每个难度还带 `NeedUnlock`，这是唯一的「本来就解锁」判据（反编译
`SongInfoExtension.GetChartInformation` 的 lambda：`locked = NeedUnlock && !record.IsUnlocked`）：

- `false` → 拥有曲包即解锁，永远不会被锁（页面上写「默认解锁」）
- `true` → 需要一次解锁事件写入谱面记录

`export_song_catalog.py` 把目录与三类解锁事件合并：

| 来源 | 字段 |
|:--|:--|
| iM 帖 | `im_topic_data.UnlockCharts`（SongId + Difficulty）+ 该帖的 `LevelLocks` / `StoryLockId` |
| **OA 分析记录** | `text/oasystemdata/oa_system_data` 的 `Rewards`（`Type 0`，RewardId 形如 `paff001_016_3`）；对象 `OASystemLocks` 给前置（等级 / OS / 剧情），68 个谱面 |
| **OS 档案** | `text/osdata/<packId>` 里每个档案的 `UnlockCharts` + `OSLockCondition.LevelLocks`（261 个档案带谱面，覆盖 555 个谱面） |
| 分支节点 | `branchingosdata.UnlockedCharts` + `UnlockCondition.Level` |
| 通关剧情 | `chartunlock.ab` 的 TextAsset `storychartunlock`：`{storyId:[{SongId,Difficulty}]}` |
| CAPSO 商店 | `capsoshopdata.ab` 的 `capsoshoppacks`：条目 `songId_0,1,2`（下划线后是难度） |
| CAPSO! 抽奖 | `gacharewarddata.ab`（**split_assets_pack_1**，不在 assetpack）：`gachareward` 里 `Type:0` 是谱面，`Id` 形如 `robo001_001_3`；`gachamachines` 只有 `capso`（The CAPSO!，$9.99） |
| 购买曲包 / DLC | `song_pack_data.is_iap_pack`；DLC 曲目另在 `expansion_pack_data`（50 包 252 首，不在离线曲库里） |

输出 `data/songs.json`：27 个曲包 / 461 首歌 / 53 首有帖子或节点来源 / 8 首有通关解锁。
附录「歌曲与获取方式」按曲包折叠，每个难度一行，状态共五种：
`iM 帖` / `分支节点` / `通关剧情` / `默认解锁（NeedUnlock=false）` / `需解锁 · 本地无记录`。

实测统计（1402 个谱面）：iM 帖 145、**OS 档案 555**、通关剧情 8、默认解锁 472、CAPSO 商店 67、
CAPSO! 抽奖 103、付费包购买 25、OA 分析记录 68（补上了 Who Am I? 的 Glitch）、无本地记录 3（1 首：vanessa001_023 Cocytus，`HideWhenLocked: true`）。

本地数据完全没有触发点、但游戏里确实能解锁的谱面，写进 **`cytus2_work/song_notes.json`**（入仓库的
手工资料，不是派生数据），导出时并入 `songs.json.notes`，页面标「外部资料」。现有条目（均由代码验证）：

| 曲目 | 解锁 | 依据 |
|:--|:--|:--|
| `ivy001_049` Heroic Age | Ivy Lv90 → 5.0 终章 → 片尾名单播完自动获得 | `StoryEnding05Main._ConditionCheck`（`level(ivy001)+1 > 89`），步骤 `STEP_0_PLAY_END_PLAY_STAFF_ROLL` → `STEP_0_GAIN_REWARD` |
| `vanessa001_023` Cocytus | 同一场景一起发放 | `UnlockAfterStoryScene.ENDING_05_UNLOCK_CHART = {"ivy001_049_0,1,2","vanessa001_023_0,1,2"}`（`.cctor` @0x2246358） |

同一场景还会解锁 `note_skin_alpha`（显示名 `Cytus α`，`judge_skin_alpha`）——见
`UnlockAfterStoryScene._ProcessEnding05Reward`（@0x2248548）：先建 `NoteSkinManager` 处理 `note_skin_alpha`，
再把 `ENDING_05_UNLOCK_CHART` 送进奖励流程。`ShouldCharacterShowAsBroken` 另有 PAFF Lv90（`level == 89`）
+ `story_ending03_good_ending2` + `story_ending04_main` 的“角色破损”判定。

附带的彩蛋：`note_skin_nostalgic`/`judge_skin_nostalgic` 的显示名是 `Cytus I`，发放点在
`End03TrueEndStaffRollRunner._InitUnlockedConditions` / `_UnlockedOneCondition(int)`——是 **ending03 true ending**
的片尾逐字母点击判定（代码里没有 `CYTUS I` 整串字面量，只有逐个回调索引）。

等级 +1 已用 Fandom 交叉验证：Aroma（`paff002`）7 首的 15 个解锁等级全部吻合
（Bring the light 6/6/7、Make U Mine 8/9/11、Anzen Na Kusuri 14/16/18、漂流 19/19/19、
Perspectives 20/20/20、風の声 21/21/22、Neon Escape 23/23/24；其余 4 首为 Lv1 默认解锁）。

### 等级是 0 基

`LevelLocks[].Level` / `OSLockCondition.LevelLocks[].Level` / 分支节点 `UnlockCondition.Level`
都是 **0 基**：`exp_data` 里每个角色表长 99（下标 0–98），所以关卡需求 `98` 在游戏里显示 **Lv99**
（`ros055` → Claim the Game Glitch）。前端统一用 `dispLevel()` 显示 +1。

抽奖限定谱面以 Glitch 为主（103 个里 43 个只给 Glitch），`IsSecret` 的 9 个是隐藏奖励；
`gachaexpreward` 是抽到经验奖励的概率表，与会话无关。
