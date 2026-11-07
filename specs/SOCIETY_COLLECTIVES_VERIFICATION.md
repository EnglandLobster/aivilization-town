# M05 居民集体程序验收（2026-10-05）

M05 的章程、独立加入、冻结程序、决定和章程交接完成工程验收。M06 真实共同资源与 M09 跨资源清算仍在总账本内，尚未验收。本次没有真实模型调用；两种用途是明确的工程场景，不是自然涌现证据。

领域：collaboration 的 collectiveModel/collectives/collectiveLifecycle 拥有原文配置、身份同意、阈值/最低参与人数/时机/改票规则、决定版本、有限执行凭据和模拟期限。原文与签署来源分开保存；修改按旧制度，旧成员的签署保留原版本，新人独立接受新版本。资源action须所属adapter验证，当前未连接的钱包操作明确拒绝。

集成：worker collectiveTools/catalog、状态事件、manifest、边界注册和模拟时间调度；应用一次commit保存章程更新与决定消费。独立查询、个人读取经历、固定上下文入口、CLI、生成Skill及管理员原始观察器已接通。新增14条命令，总计232项能力、45个命令组、72页生成Skill。

新增10项领域测试和6项运行时测试；相邻collaboration/openSociety共81项通过。覆盖独立创始同意、拒绝/期限、配置/额度验证、提案不自动投票、赞成/反对/弃权、不同程序、改票与资格、旧程序修订/新成员接受或拒绝、并发旧授权失效、退出/停摆、资源凭据预演不消费、当前和历史原文权限、旧manifest启用幂等、原子事件/重试、按大步/分步推进相同事件、重启回放。

`pnpm check` 通过：lint、全仓有序typecheck、2265项测试通过，1项既有跳过；308个测试文件通过，1个跳过。residents及全部依赖构建通过；最后补齐规则可用状态后worker再次构建通过。

真实编译后的CLI/HTTP验收28次调用（含预期拒绝）通过：四个认证身份、两个自定用途、不同门槛与结算时机、旧程序修订和新人独立同意、历史签署无伪造、声明没有实际资源效果、退出没有自动继任、重启状态相等、journal字节不变。证据：[SOCIETY_COLLECTIVES_2026-10-05.json](evidence/SOCIETY_COLLECTIVES_2026-10-05.json)。脚本：apps/residents/scripts/verify-collectives.mjs。

版本：resident-collectives-v1、open-capabilities-v11、town-resident-skill-v10、society-rulebook-v3。旧manifest保留原字节，显式enable-collectives仅追加事件；canonical/分区authority没有被默认为已经接入。
