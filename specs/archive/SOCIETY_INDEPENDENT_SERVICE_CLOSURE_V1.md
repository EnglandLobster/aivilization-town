# 私人服务责任与企业关闭的独立接入

状态：工程门禁与原世界显式CLI迁移通过。不等于全生命周期或11域清算完成。

## 边界和兼容

服务目录拥有控制、供给关系和未完成承诺，world只持有可选serviceClosurePolicy，其版本为independent-service-closure-v1。这是组合状态必须读取外部目录的要求，不授予公共权限、不复制服务状态。

ResidentServiceClosureEnabled显式记录迁移。没有该事件的旧世界继续旧事件解释；不能从新版代码或缺失字段推断启用。新执行enableIndependentServicePrincipals将分离权限事件与目录依赖事件原子提交；之前已经v3或已有幂等回执的世界使用运行者CLI `enable-service-closure --root DIR`升级。迁移拒绝未结束居民轮次、缺少principal目录以及关闭/不存在企业尚持有服务责任的历史状态；不补造资源或静默修复历史。

已有servicePrincipalEstate检查读取新marker或旧公共grant；新marker生效后，缺目录不是无责任，正常关闭命令、资本关闭与事件回放共用相同拒绝。世界合并将marker列为agreement字段，不能跨分区丢弃或拼接不同策略。旧manifest字节不改，迁移在journal留痕。

## 感知与验收

principals.list与rules世界策略主动查询显示marker，默认上下文不增加目录正文。没有新居民业务命令，只有运行者迁移入口；rulebook v57。服务原文、人员本人参与和公众管辖范围不变。

已测缺目录拒绝、真正目录未清责任、空目录允许、旧世界行为保留、重复事件拒绝、孤儿责任迁移拒绝、独立启用不扩张公共权、原子提交及journal回放。新集成测试配合原服务供给7项，共9项通过。全仓lint/typecheck/依赖build/tests正在进行，不能以此替代真实CLI迁移。

实际原世界迁移脚本为apps/server/scripts/verify-canonical-service-closure.mjs：检查无活跃轮次，调用编译CLI，逐字段核对除marker外全部world与非world状态、manifest/历史前缀、重复调用不追加事件、完整回放。未执行前不宣称canonical已升级。

## 停止条件与余项

本项到原世界显式迁移和全部门禁通过后回到整体责任地图。原工资、服务实际效果、货物保管及退出现金路径仍未齐；该依赖标记不替代任何拥有域的清偿规则或新继任权限，不启用自然人口退出。


## 验证收口

lint、全仓typecheck、依赖build通过；全仓3316通过/1原跳过。编译运行者CLI把原世界801→802，只新增依赖marker，其他world/非world状态、公共grant、manifest、历史前缀与回放不变；重复CLI为802→802，不追加事件。首份报告误留周期责任字段标签，原始校验已是serviceClosurePolicy；已保留原报告，修正标签并再次live读回/幂等验证。见`evidence/SOCIETY_INDEPENDENT_SERVICE_CLOSURE_2026-10-07.json`。

原世界目录目前为零项，不能把实际迁移当作带服务企业关闭的模型验收；未清责任拒绝来自独立领域/运行时测试。没有新增居民命令或实验剧情，下一步回到原合同消费者接续，不扩建清算界面。
