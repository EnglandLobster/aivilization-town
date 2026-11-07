# 自由实验反馈：劳动名单的参数契约

状态：实现、定向验证、全仓门禁及真实CLI通过。原始证据来自新实际生产32次自由机会，不重写原实验。

居民001与003在production.gather各连续两次遇到invalid-production-definition。原始命令未传workers；两人先调整数量，后来显式指定本人后成功。领域正确拒绝了空名单，但CLI通用帮助把所有required数组写成可省略，并自动补[]。缺的是参数基数契约，不是采集数量规则。

OpenToolProperty增加可选minItems/maxItems；实际调用边界和CLI帮助共享同一描述。production.create/gather声明workers至少一人，缺flag在CLI解析时报missing-argument:workers，HTTP直接传[]报array-too-short:workers。允许为空的证据、读者等数组仍可省略，显式空字符串仍是一个元素。领域对居民存在性、人数、授权和本人开始的校验继续保留。

没有自动把调用人加进名单，没有降低资源/劳动规则，没有修改事件语义。目录v34、Skill v33；物理规则手册仍v23。测试覆盖CLI/HTTP、缺失/空/合法与边界、失败无资源预留、旧空列表兼容，随后再次运行真实采集→加工→食用CLI。

这是一条可发现性修复，不替代学习、工资、治疗的实际时间迁移。冻结实验继续用原版本，未中途修提示或强制居民重试。

验证：pnpm check通过（2639通过/1跳过，365文件通过/1跳过）、完整依赖构建通过、32项定向回归通过、23次编译HTTP/CLI调用通过。4次预期失败包含3次领域拒绝和1次客户端缺参数拒绝；客户端退出码2与领域拒绝退出码1分别断言。重放相等且journal字节不变。证据见`evidence/SOCIETY_REQUIRED_WORKERS_FEEDBACK_2026-10-05.json`。
