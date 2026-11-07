# 真实共同账户切片验收（M06，2026-10-05）

共同账户、精确支出授权和资金清算完成工程验收。完整M06/M09仍保留其他共同资源控制、跨资产义务与整体解散验收；账户关闭不能替代组织清算。没有真实模型调用，本报告不声称自然涌现。

领域：economy commonAccountModel/commonAccounts 保存真实账户、控制版本、入资预算、结算状态和不可变交易回执；collective 是明确流通会计部门。world residentCommonAccounts 应用端口与独立projection reducer协调居民、共同账户、企业领域资金事件与国库；每个账户变化分别对账，核对平衡entries、企业领域效果和回执。资金往来不改变moneySupply。

应用：commonAccountTools 在发表动作与实际执行时分别校验，collectives.execute 把world资金事件和决定executed放在同次journal提交。失败不消费；新入资只改变revision，不改变controlVersion；修改章程或开始清算使相应旧权限失效。账目按真实账户revision排序。外部自愿出资人只知公共收款元数据及自己的交易，不获得全账或集体成员身份。

新增8项economy领域测试、4项world集成测试、7项开放运行时测试。覆盖有限数值/精确版本/会计部门、真实出资、收款方类型、少余额或无授权、回放与reducer不一致拒绝、个人/集体权限、消费仅一次、章程交接、清算冻结/非零拒绝关闭、额度不锁死清算、全流通余额与经济构成、原文页预算/实际读取、旧manifest显式启用与重启字节一致。

`pnpm check` 通过：lint、全仓有序typecheck、2284项测试通过，1项既有跳过；311个测试文件通过，1个跳过。residents及其全部依赖构建通过。新增5条CLI，总计237项能力、46个命令组、74页生成Skill。版本resident-common-accounts-v1、open-capabilities-v12、town-resident-skill-v11、society-rulebook-v4。

真实编译后的CLI/HTTP验收：独立成员表决、空余额拒绝、非成员本人入资、外部账目拒绝、原决定成功执行且不可重放、国库转移、先清算后结余分配与关闭、账户逐版本账目、货币供给守恒、重启状态/字节相等。原始次数和逐条结果：[SOCIETY_COMMON_ACCOUNTS_2026-10-05.json](evidence/SOCIETY_COMMON_ACCOUNTS_2026-10-05.json)。脚本apps/residents/scripts/verify-common-accounts.mjs。

目前common账户不能直接承担订单、债务、设施预留等义务，因此授权端口明确返回当前无这些账户义务；新增任何此类接入必须先登记真实义务再允许承诺，不能继续沿用空检查而假装清算完成。所有这些接入仍在W域和M09的完整范围中。canonical/分区authority没有新增写入口；通用projection支持新事件不等于跨分区授权已实现。
