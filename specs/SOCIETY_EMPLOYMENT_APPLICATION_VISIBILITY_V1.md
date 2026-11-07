# 本人就业申请事实的主动查询

状态：已实现并通过工程与认证CLI验收。属于B01/M01/W06/R02的可见性补齐，不新增招聘制度或居民命令。

## 证据与投入边界

分区续接第二轮的真实居民007查询公共就业名额后，检索申请状态没有获得对应入口，再次apply-job因本周期名额已用而被拒绝。当前publicEmploymentQuery只返回allowed/used，底层world.jobApplications已经保存本人申请、pending/accepted/rejected、提交与处理时间及原因。先补已有事实可见性，不增加自动申请、录用、排序或社会推荐。

## 归属与接口

worker只读adapter复用governance.employment，新增可选section=applications；默认规则页保持原结构，只增加精确展开入口。申请页按authenticated actor筛选所有历史申请，提交时间倒序、相同时间按applicationId稳定排序；使用现有offset/limit，默认10、最多30。仅返回所属world记录，不从quota-used推断结果。currentCycle与下一周期边界来自实际政策，pending不承诺录用。历史policy revision选择不能重解释申请事实。

规则页、申请页分别分页，避免同一个offset隐式移动两个列表。默认上下文仍只有既有查询指针；新增字段只在主动CLI查询出现。自然语言章程、检索命中或模型总结不成为招聘事实。

## 验证与停止条件

覆盖本人隔离、待处理/已处理/旧记录无新增字段、稳定分页、空列表、非法section、历史revision组合语义，查询前后领域状态不变及journal回放。同步CLI schema与Skill版本，运行lint、typecheck、全仓测试与相关build，再通过认证CLI读取真实记录。无需新增招聘聚合或重写旧事件。本闭环结束即回到总能力地图，不能继续派生招聘平台。


## 验收结果

新增2项测试覆盖本人隔离、pending/accepted/rejected、旧字段缺失、稳定分页/空页、非法section及revision组合拒绝，领域状态不变与完整journal回放；原3项公共制度测试保持通过。lint、全仓排序typecheck、依赖顺序build通过，全仓3308通过/1原跳过。实际认证CLI完成6次调用/1次预期拒绝，从本人真实apply-job事件读到pending，另一居民查不到该记录，查询领域状态与重放相等。

首次CLI验收使用旧worker构建产物而失败，失败原因记录于本节；按依赖重建后重跑通过，未修改领域断言。该验收是定向接口证据，不是自由采用或社会涌现证据。canonical原世界仍为revision801，未用验收脚本改动其居民状态；未来启动使用新Skill v70/catalog v66。达到本切片停止条件，返回总体能力排序。
