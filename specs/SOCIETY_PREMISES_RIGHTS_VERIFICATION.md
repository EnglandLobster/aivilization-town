# 定期空间使用权：基础能力验收

状态：本基础切片已通过工程验证，W05 整体继续开发。对应规范 `SOCIETY_PREMISES_RIGHTS_V1.md`；不把许可存在等同于收费、产权买卖或真实居住/劳动。

## 已实现

- premises 维护版本化、固定原文的 shared / exclusive 使用许可。当前控制者提出，被授予主体独立接受；控制版本失效、冲突权利、现有租约/占有/库存/劳动均可拒绝。集体须通过精确操作决定，成员身份不能代替同意。
- entry / operate / store / reside 分开。接受许可不替人到场、工作或搬家；当前控制者不能越过已接受的排他范围。许可随建筑控制交接保留，未到期义务阻止关闭和拆改。
- 生产和服务校验整个申请时段。历史授权保留已完成劳动；即使先记录到期，也不损失之前的产出、身体效果或应付报酬。
- 到期或自愿放弃阻止新增使用，保留库存及取回入口。货运接收/交付和租约入口不能绕过有效许可范围；实际承运物不会因拒绝入库而消失，可以按原约定真正退回。
- 8 个 `permits` 命令提供规则、稳定分页、原始条款/独立署名、本人当前权限、提出/接受/撤回/放弃。默认上下文只给启用标记和入口；到期批处理的私人经历同时过滤内容与参与人，不泄漏其他合同。
- 新 manifest 显式登记 `resident-premises-rights-v1`；旧 journal 可用 `enable-premises-rights` 幂等启用空聚合，不补造资产、产权或历史同意。

## 证据

`pnpm check` 通过：lint、全仓 typecheck、2502 项测试通过 / 1 项跳过，341 个测试文件通过 / 1 个跳过。日志：`/tmp/permit-complete-check.log`。

本次新增 23 项关键测试：premises 10 项、world 7 项、worker 6 项。覆盖真实生产/照护及收费、独立接受、控制权继承、排他冲突、授权结束、现有物品取回、过期物流真实退回、旧租约旁路、集体独立表态、精确请求幂等、伪造事件、批量通知隐私、时间分段等价和确定性恢复。既有建设/库存/服务/货运及全仓回归保持通过。

`pnpm --filter @aivilization/residents... build` 通过；最后的通知隔离修改已重新构建 worker。日志分别为 `/tmp/permit-build.log` 和 `/tmp/permit-final-worker-build.log`。CLI 修正为公开命令 `travel go` 后单独 lint 通过。

`node apps/residents/scripts/verify-premises-rights.mjs specs/evidence/SOCIETY_PREMISES_RIGHTS_2026-10-05.json` 通过。27 次真实编译 CLI / HTTP 调用，6 次预期拒绝。验收实际供料和施工、真实出行、独立接受、重复请求不重复授权、排他范围约束控制者、工作时段限制、到期保留产出、新投料拒绝、取回实物及私有原文。重新打开 journal 后状态一致，字节未改变。原始证据在 `specs/evidence/SOCIETY_PREMISES_RIGHTS_2026-10-05.json`，日志在 `/tmp/permit-cli.log`。

编译入口核验：337 个命令、58 个组；生成 Skill 95 页，Skill v22、能力目录 v23、规则目录 v15。

## 仍须继续完成的范围

许可本身暂不扣款。有偿许可需要 commerce 的原子接受/托管和有效供给期间证据，不能拿身体服务时长代替空间使用期间。有偿资产交割、续约/转许可、长期义务、违约/清算与公共救济继续保留在 W05/M09/G02 中。

本轮没有调用真实模型；这些结果只证明工程链路。canonical planner、分区 authority、整体 Agent 采用与无剧情自由实验仍按总 Spec 继续实施，不能由本切片通过推定完成。
