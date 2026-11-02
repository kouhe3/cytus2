# Branching OS 连线字段投影与虚线渲染

gate: passed | mode=直接做 | oracle=合成正例：`taos011`/`taos020`/`taos021` 三条边带 `is-hidden-edge`，负例：其余 47 条不带；`line_offsets` 分开 `taos019` 的两条出线 | criteria=`uv run pytest` + `cd web && pnpm typecheck && pnpm check:i18n && pnpm smoke` | date=2026-11-02

## 目标

把 `ViewSetting` 的 `ShouldHideLine` / `LineOffsets` / `HasLineIn` 投影进 canonical DB，并让 `/branch` 图：
- 游戏内不画的边（源节点隐藏出线，或目标节点没有入线口）画成淡虚线，图例说明；
- 同源多条出线的折点按 `line_offsets` 分开，取代「所有边都在列间隙中点折」的巧合重叠。

## 任务

- [x] schema + extractor：`hide_outgoing_line` / `line_offsets` / `has_line_in`（依据 F01、F02、F03）
- [x] 单测：fixture `alpha001` 的字段与对齐规则（`line_offsets` 与 `next` 同序）（依据 F02）
- [x] SPA 类型 + `branch.ts` 判据：`branchEdgeHidden` / `branchLineOffset`（依据 F01、F03）
- [x] `BranchMap`：隐藏边加类名与 `data-from`/`data-to`，折点按偏移分开（依据 F02、F04）
- [x] 图例与五种语言的文案（依据 F04）
- [x] smoke：隐藏边 3 条且来源为三个结局，图例可见，`taos019` 两条出线的折点不同（依据 F04）

## 边界

- 不实机验证（未通关到该点）；「游戏内不画线」是 L2 机制结论，视觉表现按 wiki 图补画虚线，属于阅读取向而非游戏复刻。
- 不投影 `AlignmentSetting`（另一条独立议题）。
