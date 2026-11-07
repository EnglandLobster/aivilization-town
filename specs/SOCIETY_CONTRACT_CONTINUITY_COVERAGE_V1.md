# 已有责任接续覆盖与下一实现

状态：当前源码与读端口审查；不作为完整生命周期验收。原25项、住房H3-H6、11责任域与所有运行模式保留。

## 当前跨领域证据

| 责任 | 唯一拥有者/世界协调 | 已验证 | 仍缺的实际接续 |
| --- | --- | --- | --- |
| 有限周期付款 | commerce / periodicObligations | 原主体estate现金接续 | 整体义务关闭与居民入口 |
| 银行原仓位 | credit / residentEstateCredit | 原现金及逐日结算 | 本金处分/完整违约债权、自然人口 |
| 原资本收益退款 | enterprise / capitalEstateContinuity | 真实收入与退款到原主体 | 原权益处分及全部经营责任 |
| 原租约 | society+commerce / leaseEstateContinuity | 到期/本人结束/欠期、押金、两estate间租金、多周期 | 完整居住救济与自然人口/继任CLI |
| 服务履约 | services / serviceEngagementPorts | 原出资人退出后的收入与退款；参与者退出前已结算到边界的即时中断 | 自然人口的边界先后顺序；企业雇佣参与者与工资原子终止 |
| 货运 | logistics+materials / logisticsPorts | 活居民运输、在途保管与返还 | 普通授权仍读residentFinancialAccount；原付款人托管退款接续已实现（SOCIETY_LOGISTICS_ESTATE_CASH_V1，工程验收通过）；承运人退出/货物位置与新扣款仍需各自处理 |
| 已赚工资 | enterprise / residentLabor、productiveWages、serviceWages | 定时劳动退出接续；生产/服务已结束债权接续通过3334全仓测试与依赖构建 | 活跃生产/服务退出原子编排、自动后续偿付调度与全人口组合 |
| 企业服务资源清算 | services / servicePrincipalEstate | 显式独立依赖marker，真实801→802迁移；缺端口拒绝 | 整体11域清算，不以目录单项代替 |

共用residentEscrowAccounting已经能验证estateCashSettlement，但存在能力不代表每个消费者已接入。不得直接把所有exists改成金融主体存在：那会允许死者开始服务、驾驶、劳动或作新承诺。现金读口、本人行动权限、旧约的客观结算是三个不同端口。

## 历史诊断：已修复的公共权限耦合

`apps/worker/scripts/audit-independent-service-closure.mjs`在无公共grant、独立v3目录下，services拥有领域返回企业尚有clinic，world.enterpriseServiceEstateRefusal却返回undefined。证据`evidence/SOCIETY_INDEPENDENT_SERVICE_CLOSURE_GAP_2026-10-07.json`明确acceptance=false；只验证读端口，不声称已执行企业关闭。

根因：旧版本把publicGovernance.authority.grant.services兼作“存在外部服务目录”的标记。私人目录独立后，该代理信号不再完整。函数同时用于新命令与历史事件回放，不能简单替换条件并重解释旧事件，也不能在缺端口时把UNKNOWN变成清空。

## 独立目录已完成实现的边界

1. 服务聚合继续拥有目录、经营关联、预约与真实在场；world只记录显式、版本化的外部目录依赖要求，不复制目录或赋予公共权力。
2. 新启用与旧独立世界迁移都必须记录该要求；已有v2/v3事件和snapshot解释保留。迁移校验当前权威目录与企业状态，若已有关闭企业遗留责任必须拒绝并报告，不能偷偷修复历史。
3. 命令、资本关闭和回放统一读取该要求；新模式缺端口拒绝，提供目录后用services唯一的enterpriseServiceEstateIds。移除公共grant不解除责任，公共/私人身份也不能改变所有权检查。
4. 完成真实命令拒绝、原子状态不变、正常清理后允许关闭、缺目录拒绝、旧历史兼容、重复迁移/回放与canonical组合字段覆盖。通过后回总图，随后接消费者现金与身体中断，不能沿企业目录继续造退出平台。

此项优先，因为它恢复已经宣称独立启用的私人服务与已有企业关闭之间的边界；不是增加社会制度。新自然退出仍须等待服务/工资/货物等全部保全端口。当前canonical实验保留revision802，不启动新模型或人为死亡。
