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
OS 档案中的一条记录：所属文件、编号、日期、正文 blocks、影片引用。
_Avoid_: OS 文件、entry、archive（泛指文件时）

**OA Character / OA Object / OA Document**:
OA 探索档案的角色、可点击物件，以及挂在物件下的文件。
_Avoid_: 联动章节

**Story Node** (`story_node`):
叙事单元，`kind` 为 `event`（剧情事件）或 `branch`（Branching OS 节点）。剧情闸不是节点，是 `requires_story` 边。
_Avoid_: 剧情闸（作实体）、把 Branching OS 节点叫「备份节点」

**Branching OS** (`story_node`，`kind=branch`):
新角色的分支式 OS：节点按曲包等级与分支状态解锁，和备份数据库不是同一套东西。
_Avoid_: 备份数据库、backup

**Backup Database** (`gallery_item`):
备份数据库里的一条媒体条目：影片、图片或 boss stage，按 `folder` 组织并带解锁条件。
_Avoid_: 备份节点、branching node

**Boss Stage** (`boss_stage`):
剧情里的特殊演出关卡（曲目 + 难度 + 舞台）；既属于剧情事件，也作为备份数据库条目出现。
_Avoid_: boss 曲、活动曲

**Character** (`character`):
拥有等级与经验曲线的游戏角色（如 NEKO#ΦωΦ，id `neko001`）。iM 与 OS 的等级锁指向角色，不指向曲包。
_Avoid_: 把角色叫「曲包」、pack

**Song Pack** (`pack`):
歌曲的发行集合（`song_pack_data`）；一首歌通过 `pack_id` 归属它。同名字符串可能同时是角色 id（`character/neko001` 与 `pack/neko001`），但两者是不同实体。
_Avoid_: 把 pack 当作等级拥有者

## 音乐

**Song** (`song`):
一首曲目：曲名、曲师、所属曲包。
_Avoid_: 曲子、track

**Chart** (`chart`):
某首曲目在某难度下的谱面，主键 `song/<songId>@<Difficulty>`；拥有独立的 `NeedUnlock`、等级与解锁来源。
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

## Wiki 导出

**Page model**:
实体到页面结构的中间表示：section 顺序、信息框字段、链接目标、分类。渲染器只负责把它变成某站方言。

**Wiki renderer**:
把 Page model 渲染成某站 wikitext 的适配器；本批只有 BiliGame 一个实现。

**Parameter patch**:
对已有页面只替换模板参数块的最小写入单元；整页只用于新建页面。

**Red link check**:
用目标站 `allpages`（区分条目与重定向）判定输出中的 `[[链接]]` 是否有对应页面。
