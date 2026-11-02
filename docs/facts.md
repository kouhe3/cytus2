# Facts

只增不减的机制台账（premise-gate §8）。等级：L1 反编译文本、L2 指令/符号/数据 dump、L3 运行日志与单测、L4 实机观察。
上游版本变化（游戏更新、`libil2cpp.so` 或 `branchingosdata` 换代）后，受影响行置 `过期`，另起勘误行。

| id | claim | 等级 | 出处 | 状态 | 影响 |
|---|---|---|---|---|---|
| F01 | `ViewSetting.ShouldHideLine` 为 true 时，分支图不为该节点生成任何出线对象 | L2 | `cytus2_work/libil2cpp/libil2cpp.so`（v5.3.0）`_BuildBranchProps` @0x2242298：`0x22427d0 LDR X8,[X24,#0x40]` 取 ViewSetting，`0x22427e0` 取 `LinkedFileIds.Length`，`0x22427e8 LDRB W9,[X8,#0x20]`，`0x22427ec CBNZ → MoveNext`；字段布局 `cytus2_work/il2cppdumper/dump.cs:73716` | 已证（机制） | 投影 `hide_outgoing_line`；/branch 虚线 |
| F02 | `ViewSetting.LineOffsets[i]` 是第 i 条出线（按 `LinkedFileIds` 顺序）肘部的水平位移，写入 `BranchViewComponent.Property.DeltaX` 后进入 `JointLineRenderer._deltaX` | L2 | 同函数 `0x2242990 LDR X8,[X24,#0x40]` → `0x2242998 LDR X8,[X8,#0x28]` → `0x22429bc LDR S2,[X9,#0x20]`（第 i 项）；`BranchViewComponent.Render` @0x2244458 打包 Property；`JointLineRenderer.OnPopulateMesh` @0x223EE40 使用 `_deltaX` | 已证（机制） | 投影 `line_offsets`；图按数据分开同类折点 |
| F03 | 普通节点的芯片样式由 `ViewSetting.HasLineIn` 决定：true → `File1In1Out(0)`，false → `File1Out(1)`；Ending/TrueEnding/BranchingPoint 不读它 | L2 | `_GetBackgroundStyle` @0x22431B0：`0x22432d8 LDR X8,[X19,#0x40]`，`0x22432e0 LDRB W8,[X8,#0x30]`，`0x22432e4 EOR W0,W8,#1`；`BackgroundStyle`/`AnchorProvider` 字段见 `dump.cs` TypeDefIndex 2614/2570 | 已证（机制） | 投影 `has_line_in` |
| F04 | 游戏内 19→20（`taos011`/`taos020`/`taos021` → `taos022`）不画连线：Ending 芯片只有 In 锚点，`GetPositionFor(Ending, Out)` 走异常分支，三个结局的数据用 `ShouldHideLine=true` 兜底 | L2 | `sharedassets35` 预制体锚点只有 `Ending-In`/`TrueEnding-In`；`AnchorProvider.GetPositionFor` @0x2233FD4 case 5 只允许 port=0；数据 `cytus2_work/text/branchingosdata/tairitsu001`。L4 缺口：未做实机截图确认 | 已证（机制） | /branch 虚线 + 图例 |
| F05 | wiki 分支图里 19→20 的红色括号不是游戏线条渲染器的输出 | 待证 | 用户截图（来源为 wiki）；`sharedassets35` 贴图清单无括号资源；线条参数为 thickness≈2、折角 75°、解锁态 glow，与截图直角无线光不符 | 待证 | 文档结论；需 L4 实机或视频复核 |
