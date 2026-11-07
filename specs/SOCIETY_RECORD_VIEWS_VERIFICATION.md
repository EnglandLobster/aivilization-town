# M02 居民数据视图验收（2026-10-05）

M02 工程契约通过；完整社会能力仍以总账本为准。本次未调用真实模型，不能声称居民已自主创造或采用平台。

领域归属 information：`recordViewModel.ts` 保存封闭计算语言与版本化预算，`recordViews.ts` 决策/查询/事件回放，`sharedRecords.ts` 增加可从旧事件重建的按 register 索引。worker 的 catalog/tools/state/runtime 连接权限、journal 和真实读取经历；CLI/Skill/观察器提供展开入口。

新增7项领域测试、4项运行时测试覆盖两个用途、整组聚合与分页、稳定排序、版本和历史、双重ACL撤回、空集与非法计算、有限预算、不可变输入、无权威世界写入、旧manifest启用幂等、过大原文不伪造已读、重启回放。相邻 information/openSociety 回归92项通过。

`pnpm check` 通过：lint、全仓有序typecheck、2249项测试通过，1项既有跳过；306个测试文件通过，1个跳过。`pnpm --filter @aivilization/residents... --sort build` 通过。格式化后唯一补正是验证完成的 select 数组采用显式类型收窄再复制，修正 lint 的 any-spread 提示。

编译后真实 HTTP 与 `town` CLI 验收18次调用通过，包含预期拒绝；三名独立身份、两个不同用途、完整输入聚合13、ACL撤回、世界不变、回放相等与journal字节不变。机器证据：[SOCIETY_RECORD_VIEWS_2026-10-05.json](evidence/SOCIETY_RECORD_VIEWS_2026-10-05.json)。脚本：`apps/residents/scripts/verify-record-views.mjs`。

版本：resident-record-views-v1、open-capabilities-v10、town-resident-skill-v9；218个能力契约、44个命令组、70个生成Skill页面。旧manifest不自动启用，operator enable-record-views保存单次事件而不重写原文件。仅开放居民单写入路径；canonical/分区authority未新增adapter。

有意的计算边界：每个view引用一个有类型的register；不执行任意代码、不递归、不跨私有世界数据、不替居民定义全局评分。新增真实数据源/效果须通过总Spec边界分类和各领域契约。
