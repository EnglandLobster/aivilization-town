# 企业经营交接与付款：原子组合验收

2026-10-05。M04/M07/M09/W05/W06组合切片；管理权不是股份，定向成交不是自由居民自发组织。

`pnpm check`通过：lint、全仓typecheck、2760项测试通过/1项跳过，391文件通过/1文件跳过（`/tmp/enterprise-exchange-final-check.log`）。居民及全部依赖build通过（`/tmp/enterprise-exchange-final-build.log`）。生成文档与目录版本为43/42/32，既有360路由。

编译HTTP/CLI脚本`apps/residents/scripts/verify-enterprise-exchange.mjs`共15次调用、6次预期拒绝：v2拒绝企业语法、未启用v3拒绝、缺少独立授权拒绝、缺钱后全部回滚、不消费授权、补款后原子交接/付款、成功幂等、旧管理人越权拒绝。企业资本/物品/雇员/原始创立人保持；真实principal/executor分别记录。

另外验证v2已签协议在v3显式升级后仍按v2执行；旧状态、原manifest、逐字节journal与重放一致。伪造交接主体、控制版本、企业ID及重复/夹带事件拒绝；不重新运行实时决策来猜测历史。新manifest与不兼容配置有验证，规则目录的经营能力可用性跟随实际启用状态。

自由实验升级前，新冻结引擎重放free-224全状态相等。原manifest和implementation未改；升级仅写1762号协调策略事件，既有两个公共工作与一个采木过程、身体/财产、提醒、关系和模型会话保留。独立部署6110文件解除硬链接，81份第一方SHA256指纹保存到阶段记录。已经开始下一32次自由机会；完成前不报告采用结果。

范围仍包括共同融资/股权、集体程序主体、车辆原子交接、长期义务和完整继任、公共资产/建设采购、住房选择、更多居民可改制度及全运行模式。

[机器证据](evidence/SOCIETY_ENTERPRISE_EXCHANGE_2026-10-05.json) · [边界Spec](SOCIETY_ENTERPRISE_EXCHANGE_V1.md)
