# Cytus II 剧情数据库（wiki-ready）

从 Cytus II 客户端解包抽取、可完整重建的领域模型，供 wiki 与新 SPA 共用。派生数据不入库；仓库只保留抽取器、手写 schema、人工覆盖层与前端源码。

## 内容实体

**IM Post** (`im_post`):
iM 社群的一条帖子：作者、头像、多语言标题与正文、回复树、附件。
_Avoid_: 帖子、article、topic

**IM Reply** (`im_reply`):
帖子下的一条回复。游戏内没有楼中楼：323 帖共 4155 条回复，全部扁平（最大深度 1）。
_Avoid_: 楼中楼、嵌套回复

**OS Log** (`os_log`):
OS 档案中的一条记录：所属文件、编号、日期、正文 blocks、影片引用、`position`（osdata 数组内顺序）与 `level_lock_display`。首次打开该档案时播放的过场以可选 `cutscene` 引用：`text/cutscenedata/cutscene_data_os` 的 `MovieFile` 去掉 `.mp4` 的裸片段名，无过场的记录不带该字段。
_Avoid_: OS 文件、entry、archive（泛指文件时）

**OS 锁定态**（来自 `OSFile.GetLockStatus`）:
`Hidden`（列表不出现）、`Locked`（显示 `???` 与锁图标）、`Unlocked`。等级锁之间是 AND：任一未达即锁定；`Locked` 还要求 `LevelLockDisplay` 为真且至少一个等级条件已达成，否则 `Hidden`。`FileLockId` 未满足时始终 `Hidden`。
_Avoid_: 把 `level_locks` 的任意一条当成解锁条件（是全部满足）

**OA Character / OA Object / OA Document**:
OA 探索档案的角色、可点击物件，以及挂在物件下的文件。
_Avoid_: 联动章节

**Story Node** (`story_node`):
叙事单元，`kind` 为 `event`（剧情事件）或 `branch`（Branching OS 节点）。剧情闸不是节点，是 `requires_story` 边。
_Avoid_: 剧情闸（作实体）、把 Branching OS 节点叫「备份节点」

**Branching OS** (`story_node`，`kind=branch`):
新角色的分支式 OS：节点按分支 OS 自己的进度等级与分支状态解锁，和备份数据库不是同一套东西。
节点上的 `level` 就是游戏显示的等级（存档 `Progress + 1`），每读完一个结局归零重来，最多 5 轮；
`state_id` 是 `BranchingOS.StateId`：`0`/`1` 读轮组状态，`2`/`3` 读分支点点击结果（`BranchingSelect` 0 = Leave / 1 = Hit），`4` 要求先读完列出的文件。
_Avoid_: 备份数据库、backup

**Backup Database** (`gallery_item`):
备份数据库里的一条媒体条目：影片、图片或 boss stage，按 `folder` 组织并带解锁条件。
_Avoid_: 备份节点、branching node

**Boss Stage** (`boss_stage`):
剧情里的特殊演出关卡（曲目 + 难度 + 舞台）；既属于剧情事件，也作为备份数据库条目出现。
不是所有 boss stage 都有备份数据库条目：Branching OS 的分支点（如 `taos010_bossstage`）只在
`song_pack_data.other_song_info_list` 里登记，这类记录的 `folder_id`/`gallery_item_id` 为 null。
_Avoid_: boss 曲、活动曲

**Character** (`character`):
拥有等级与经验曲线的游戏角色（如 NEKO#ΦωΦ，id `neko001`）。游戏内的 `SongPackId` 就是角色 id；iM、OS 与曲目解锁的等级锁都指向它，而不是指向商业曲包。
_Avoid_: 把角色的 `SongPackId` 当成商业曲包；把角色叫「歌曲包」

**Character Pack** (`pack`):
角色在商店/曲库里的发行记录（`song_pack_data.offline_song_pack_list`）：`song_pack_id` 就是角色 id，携带价格、IAP、`hasIM`、主题色与该角色基础曲目。与 `character` 1:1，但一个负责等级/锁，一个负责发行与展示。
_Avoid_: 把 `pack` 当作等级/锁拥有者；把 Song Pack（`expansion_pack`）叫 pack

**Song Pack** (`expansion_pack`):
只卖歌曲、不卖角色的追加曲包（`expansion_pack_data.ExpansionPackList`，如 `expack049` Kizuna AI Extend 2026）。每首歌带 `SongPackId`，指向它归属的角色；购买后显示在该角色下，并共享该角色的等级与解锁门槛。
_Avoid_: 把角色包（`pack`）叫 Song Pack；把 Expansion Pack 当成新角色

## 音乐

**Song** (`song`):
一首曲目：曲名、曲师、所属角色。`所属曲包` 是商业曲包，不是角色包；见「Wiki 渲染约定」。
_Avoid_: 曲子、track

**Chart** (`chart`):
某首曲目在某难度下的谱面，主键 `song/<songId>@<Difficulty>`；拥有独立的 `NeedUnlock`、等级与解锁来源。每张谱面自带 `music_id`（该难度播放的音源）与 `duration_seconds`（该 AudioClip 的时长，取自 `songdata_<songId>.ab`）；同一 Song 的不同难度可以是不同音源（THE BEGINNING 的 Easy/Hard/Chaos 为 1:20 / 1:07 / 2:18），所以谱面的音频属于谱面，Song 不是 Chart 的父节点。APK 未随包的 DLC 音频没有时长字段。
_Avoid_: 难度（作为 song 的字段）、谱面文件

**Difficulty**:
`Easy | Hard | Chaos | Glitch | Crash | Dream | Drop` 七档。

## 商店

**CAPSO Shop Pack** (`capso_shop_pack`):
用 CAPSO 点数或 IAP 购买的商店包，条目为 Chart 或造型。
_Avoid_: CAPSO（泛指商店与抽奖）

**Gacha Machine / Gacha Reward** (`gacha_machine` / `gacha_reward`):
抽奖机，以及按权重、可能隐藏发放的奖励。

**Shop Bundle** (`shop_bundle`):
IAP 礼包（本地数据为 VOL1 / VOL2），条目为角色或扩展包。

**Black Market**:
`shop_bundle.black_market = true` 的售卖状态，不是独立实体。
_Avoid_: 黑市（作实体）

## 模型

**Spoiler Alert** (`spoiler_alert`):
角色内容的剧透提醒：在条件满足前不要读。`SpoilerAlertTable` 只有 4 条（ivy001、cherry002、vanessa001、bobo001），条件为若干角色的等级。阅读顺序按条件等级**延后**内容，而不是禁止。
_Avoid_: 把剧透门当成硬锁

**Reading order** (`reading_order`):
模拟 5.3 新玩家的三阶段广度优先顺序：免费（free）→ 付费（paid）→ 联动/支线（side）。同阶段内所有角色等级同步推进（受 `IsLevelLocked` 硬上限约束），每次升级后立刻阅读已解锁的 iM 与 OS。
_Avoid_: 把按章节或按版本当成默认顺序

**Character tier**:
角色分组 `free | paid | side`，来自 `characterTiers`；决定阅读顺序的阶段。

**Edge**:
类型化关系 `(source, relation, target)`，如 `requires_story`、`unlocks_chart`、`same_level`；由管线派生，不手工维护。

**Provenance**:
一条事实的证据指针：TextAsset 名 + 字段路径、RVA，或人工来源说明。

**Canonical DB**:
由 APK 构建出的实体与边集合（JSONL + SQLite），不入 git。

**Derived artifact**:
任何可由管线重建的产物：正文、边、索引、wiki 页面、SPA 数据。

## 阅读顺序（`reading_order`）

**Stage**:
阅读轮次。iM 帖用 legacy 全局 fixpoint（1..N），其他实体用分档模拟轮次；`98` 是模型外（blocked）桶，`99` 是无法定位的行。
_Avoid_: 与 `read_index`（legacy iM 序号）或 `order`（默认全序）混用

**Cost** (`reading_order.cost`):
一行的解锁成本：`level_locks` 所有等级之和；多角色锁按各角色等级相加。同一 `stage` 内先按成本排序。
_Avoid_: 货币价格；与 `level_gate`（有效门槛）混用

**Lane** (`reading_order.lane`):
账户排序车道：free `0..`、paid `100..`、side `200..`、剧情/其他 `300`。同一 `stage` 内成本相同时按 `lane` 排序，表示读者跟随哪个账号，不代表解锁难度。
_Avoid_: 路线、章节；与 `thread`（行所属角色线程）混用

**Lock level** (`reading_order.lock_level`):
该行阅读阶段到达时，PAFF / NEKO / ROBO 三人已达到的最高等级（0-based）。iM 帖沿用 legacy fixpoint 的轮次等级；其他实体用模拟轮次。
_Avoid_: `level_gate`（含剧透延后后的有效门槛）、`original_level`（实体自身锁）

**Read index** (`reading_order.read_index`):
legacy iM 全序编号，仅 iM 帖有值且连续为 `1..N`；用于与冻结 viewer 的 `readIndex` 对齐。非 iM 行恒为 `null`。
_Avoid_: `order`（默认 free → paid → side 的全局位置）、`stage`

**External** (`reading_order.external`):
被排除在模拟之外的行的原因：story 锁、topic 锁，或无法建模的等级/前置条件；blocked（`stage=98`）或无法定位的行才有值。
_Avoid_: 把原因当成实体；与 `unlock_condition`（实体自身字段）混用

**Branch** (`reading_order.branch`):
由 `StoryLockId` 人工映射的结局分支语义码之一：`good_ending1`、`good_ending2`、`ending04`，附 manual provenance（locator + 理由）。DB 只存语义码，显示标签由 SPA 本地化。
_Avoid_: 与 `story_node.kind=branch`（Branching OS 节点）混用；不要把显示文本写进 DB

**Timeline scope** (`reading_order.timeline_scope`):
一条阅读顺序记录属于哪里：`timeline` = 全局解锁时间线（全部 iM 帖 + 主线 7 人的 OS），`character` = 只在角色页按 `Category` 分组、按 osdata 数组顺序（`os_log.position`）阅读的 OS，`none` = OA 文档与故事节点。角色页的 iM 页签只对 PAFF / NEKO / ROBO 开放；这是游戏的角色页导航结构，不由 `imFilters`（iM feed 的账号过滤维度）推导。PΛFF 没有 iM 账号入口。
_Avoid_: 把 `character` 当成「角色实体」；把 `imFilters` 的账户当成角色页 iM 页签的依据

## 搜索

**Search**（搜索）:
一次查询同时覆盖实体标题与叙事正文，产出一份结果集。palette 与 `搜索结果页` 展示的是同一份结果，不是两种检索。
_Avoid_: 把「搜索实体」与「全文搜索」当成两个功能；把两种入口说成两套索引

**Search preview**:
Search 的即时子集：在 Ctrl K 面板里按类型分组显示的头部命中，不离开当前页面。
_Avoid_: 把 preview 当成独立的实体搜索

**Search expanded**:
Search 的全量视图（`/search?q=`）：可分享、可键盘遍历，每类显示「已显示 / 总数」。
_Avoid_: 全文搜索页（暗示它只搜正文）

**Search result**:
能打开一个实体的命中，带类型、标题与命中片段。标题命中与正文命中同等是结果，只在排序上区分。
_Avoid_: 把页面入口算作结果

**Jump entry**（跳转）:
palette 里指向固定页面的入口（时间线、各索引页），不打开实体，因此不是 Search result。
_Avoid_: 导航目标（与 sidebar 的视图导航混用）

## Wiki 导出

**Page model**:
实体到页面结构的中间表示：section 顺序、信息框字段、链接目标、分类。渲染器只负责把它变成某站方言。

**Wiki renderer**:
把 Page model 渲染成某站 wikitext 的适配器；本批只有 BiliGame 一个实现。

**Parameter patch**:
对已有页面只替换模板参数块的最小写入单元；整页只用于新建页面。

**Red link check**:
用目标站 `allpages`（区分条目与重定向）判定输出中的 `[[链接]]` 是否有对应页面。

**Title normalisation**:
跨导出器、补丁匹配与校验共用的标题等价规则（`cytus2db.wiki.titles`）：NFKC、
`_`↔空格、空白折叠、仅首字母大小写不敏感，另加全角/半角括号、破折号族、冒号、
括号前空格与 CJK 邻接空格的显式折叠。整页输出与已有标题同键即视为覆盖，必须改走补丁。
_Avoid_: 用 `casefold` 比较整个标题（`NEKO` 与 `Neko` 是两页）

**Canonical link target**:
输出链接时用快照中的规范拼写回写目标；目标只在宽松键下唯一命中时才回写，
多义时不猜，留给红链报告。

**Known-missing title**:
`wiki/snapshot/known_missing.json` 中人工列出的、确实没有页面的红链目标；每条都带原因。
校验把它们单独报告，不算失败；未列入的目标仍是错误。
_Avoid_: 把「未匹配」静默当缺页

## Wiki 渲染约定

**所属曲包** (`song.pack`):
Bili `歌曲` 模板的商业曲包参数，不是角色包。黑市曲填曲包名；CAPSO 抽奖独占、且不属于任何商业曲包的曲目填 `CAPSO`；其余留空（模板默认免费）。角色包名（PAFF、Xenon 等）禁止写入。
_Avoid_: 把 `pack` / 角色包当所属曲包

**POEM** (`<poem>`):
MediaWiki 的换行保留标签。OS 档案正文**不使用**（Bili 的 `Os/文件` 文档示例即普通文本）；OA 纯散文文档在正文开头和结尾各放一次，模板与对话混排的 OA 不使用。
_Avoid_: 给每条 OS narration 套 `<poem>`、给每个 OA narration 单独套 `<poem>`
