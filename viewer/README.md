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
| 曲包阶梯 | 26 个曲包，标题显示角色名（`paff003` → `PΛFF`），编号作为右侧 ID | 每个 level 一行：同一刻解锁的 iM 帖与 OS 条目（可点跳） |
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
