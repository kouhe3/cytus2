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
一条阅读顺序记录属于哪里：`timeline` = 全局解锁时间线（全部 iM 帖 + 主线 7 人的 OS），`character` = 只在角色页按版本阅读的 OS，`none` = OA 文档与故事节点。角色页的 iM 页签由 `imFilters` 中是否存在该角色的账户条目决定；没有条目就不渲染页签。
_Avoid_: 把 `character` 当成「角色实体」；它描述的是阅读入口

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
