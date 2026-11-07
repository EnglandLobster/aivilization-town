# 原子资源交割基础工程验收

日期：2026-10-05。范围是 W05 / M04 / M07 的六类个人资源原子交割基础，不是完整社会能力验收。

## 验证结果

- `pnpm check`：lint、全仓按依赖排序 typecheck、2558 个测试通过，1 个跳过；349 个测试文件通过，1 个跳过。该批新增 35 个针对性测试。
- `pnpm --filter @aivilization/residents... build`：依赖包、worker 与 residents 编译及类型输出通过。
- `node apps/residents/scripts/verify-atomic-exchange.mjs specs/evidence/SOCIETY_ATOMIC_EXCHANGE_2026-10-05.json`：76 次实际编译 CLI/HTTP 调用，20 次预期拒绝。
- 完整原始证据：[JSON](evidence/SOCIETY_ATOMIC_EXCHANGE_2026-10-05.json)。未调用模型。

## 实际证明的事实

premises、stock、space、register、view、group 均执行了卖方独立授权移交、买方独立授权接受及付款、第三人按指定程序运行。各领域对象只改变自己的控制事实，资金使用既有平衡转账。CLI 中建筑经真实材料投入和施工形成，六笔各 3 的付款共 18；货币供给不变。

缺少任一主体授权、授权耗尽、外人读取私人程序、原控制人再次处分均拒绝。最后付款不足时，之前临时成功的 offer/accept 不进入真实状态，也不消费成功次数。重复 request-id 不重复交割或扣款。

原文、条目、存货和历史作者保持不变。群组交接按原领域规则使待接受邀请失效，已加入成员没有被替换。重启后状态完全一致，journal 原始字节没有变化。

针对性测试另覆盖：步骤授权被替换、源修订过期、撤权、错误动作、身体状态不变、事件缺失/重复/重排、删去执行证明、修改付款并重算 SHA 引用、原子资源改变后追加反应队列、实际响应消息归因、多时间边界中的定时交割、迁移幂等与旧 manifest 保持旧义。

## 机制与兼容

动作启用为 `resident-program-actions-v2`；执行凭据为 `ordered-program-transaction-v1`；journal 顺序引用为 `ordered-society-effects-v1`。旧程序没有新增动作版本就保持旧动作集合，旧无顺序引用的 journal 保持历史解释。新 manifest 显式选择或旧实验显式执行一次系统迁移。

居民仍用 `town programs` / `town mandates`，没有开放任意命令执行、身体代理或随意修改 actor。每步保留 principal、实际 executor 和授权版本。目录 v25、居民 Skill v24、规则书 v17；命令总数未因内部 `resource.control` 增加。

## 尚需完成的同一总目标

service 管理、车辆与企业控制、集体精确决定与程序组合、长期义务、其余生活能力及公共治理、canonical/partition 接入继续按总 Spec 开发。本次脚本和单元测试均为工程验收，不能冒充独立模型操作或自由运行中的社会涌现。
