# Cytus II 剧情数据库（wiki-ready）

从 Cytus II 客户端解包抽取、可完整重建的领域模型，供 wiki 与新 SPA 共用。派生数据不入库；仓库只保留抽取器、手写 schema、人工覆盖层与前端源码。

## 内容实体

**IM Post** (`im_post`):
iM 社群的一条帖子：作者、头像、多语言标题与正文、回复树、附件。
_Avoid_: 帖子、article、topic

**OS Log** (`os_log`):
OS 档案中的一条记录：所属文件、编号、日期、正文 blocks、影片引用。
_Avoid_: OS 文件、entry、archive（泛指文件时）

**OA Character / OA Object / OA Document**:
OA 探索档案的角色、可点击物件，以及挂在物件下的文件。
_Avoid_: 联动章节

**Story Node** (`story_node`):
叙事单元，`kind` 为 `event`（剧情事件）或 `branch`（分支节点）。剧情闸不是节点，是 `requires_story` 边。
_Avoid_: 剧情闸（作实体）、备份节点（作独立实体）

**Character** (`character`):
游戏角色 / 曲包身份。
_Avoid_: 人物、hero

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

**Edge**:
类型化关系 `(source, relation, target)`，如 `requires_story`、`unlocks_chart`、`same_level`；由管线派生，不手工维护。

**Provenance**:
一条事实的证据指针：TextAsset 名 + 字段路径、RVA，或人工来源说明。

**Canonical DB**:
由 APK 构建出的实体与边集合（JSONL + SQLite），不入 git。

**Derived artifact**:
任何可由管线重建的产物：正文、边、索引、wiki 页面、SPA 数据。
