# wiki 字段只写 APK 可验证的值

导出到 wiki 的字段只使用能从 APK 抽取并验证的值；BPM、时长、Note 数、谱师、歌词等当前无法验证的字段**省略参数**，已有页面上的原值保留。不从 Bili/Fandom 现有页面回填 canonical DB，也不把 wiki 当数据源。

## 考虑过的方案

- **从现有 wiki 回填**：能让首次生成的页面更完整，但 wiki 内容本身是二手来源，回填会形成循环引用，并让页面的「数据来源」失去意义。
- **留空参数**：模板会渲染空行，且看起来像「数据缺失」，不如省略。

## 后果

- 首次生成的页面在这些字段上不完整；需要另开抽取 ticket 从 `songdata` 挖 BPM/时长/Note 数。
- 人工补充只能进覆盖层（如 `song_notes.json`），并标注来源，不能直接改生成物。
- wiki 侧的人工事实集中在 `tools/cytus2db/wiki/overrides.py`（如结局分支标签），
  每一项都以 `kind: manual` provenance 记录 locator 与理由；生成页面底部的
  `== 数据来源 ==` 会把这些条目渲染成 `<ref>`，游戏数据则只列 `<code>` locator。
