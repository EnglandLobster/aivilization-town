# 居民数据视图：M02 实施契约

归属：[社会能力账本](AGENT_DRIVEN_SOCIETY_CAPABILITY_CONTRACTS.md)的M02。状态：工程验收通过（[证据](SOCIETY_RECORD_VIEWS_VERIFICATION.md)）。此能力用于居民自行组织信息、计算自己的指标，不赋予指标世界权威，也不改变公共Wiki只索引原文的规则。

## 领域与对象

information拥有RecordViewPolicy、版本化ResidentRecordView及其原始定义历史；不依赖world。输入源为一个明确的shared register，所有现存字段类型已知。view作者选择标题、可见性、允许读取者和定义；查看/执行者必须同时有view权限与源register当前读取权限。作者撤回源访问权后也不能利用旧视图续读。

定义为封闭JSON对象：sourceRegisterId；select字段数组；where比较条件数组（全部满足）；derive命名的数值表达式；orderBy字段及asc/desc；可选aggregate（count/sum/mean/min/max）。所有键严格验证，不能嵌入脚本、路径、网络请求或任意工具名。没有递归调用另一个视图或查询私有世界余额的入口。

数值表达式只允许finite常数、源数值字段，以及二元add/subtract/multiply/divide；不得引用另一个派生字段以隐藏循环。除零、溢出和非有限中间结果明确拒绝。筛选支持同类型eq/ne，数值比较gt/gte/lt/lte和字符串contains。未知字段、异类比较、原型保留名拒绝。

select可选择源字段和派生字段；orderBy最多两项，同分以原始record key稳定打破平局。没有orderBy时按key排序，不按平台认为的质量排序。聚合只在完整授权且预算内的筛选结果上执行；空集合count/sum为0，mean/min/max为null，不生成NaN。

## 预算和来源

策略resident-record-views-v1：每作者最多20个视图（停用仍保留历史）、最多8个筛选、8个派生字段、16个输出列、2个排序字段；表达式深度4、总节点64；每次最多扫描1000条源记录、100000个表达式节点求值。定义序列化最多12000字符。分页默认10、最大30，结果预算沿用runtime，不能把截断后的聚合伪称全量。

源数据版本由register revision和该register全部record revisions之和共同确定；记录只追加版本，删除是tombstone，故每次数据写入都会使该版本推进。记录分页返回原始key/revision/作者等来源；聚合返回源版本、完整扫描数与匹配数，查询回执不自动改写任何原文。

查询只扫描源register索引。该索引是事件产生的读模型，可从历史重建；旧状态无索引时有明确兼容重建路径，不成为第二套写模型。所有查询结果标记resident-computation，保留view作者、view revision及resident-claim输入来源。任何“信誉”“成员”“余额”列只是作者定义的计算。

## 命令与状态

views publish/revise：本人建立/修订视图，revision=1或预期当前版本；保留全部旧定义。views disable：作者停止未来使用。views list/read/history/query：按当前双重ACL可见；停用后定义历史仍可读，query拒绝。查询记录精确输入版本，可被本人检索，但不自动进入所有人的认知。

RecordViewChanged事件存最终完整对象，RecordViewsEnabled记录策略；reducer只重建，不执行查询。新实验显式声明可选recordViewsPolicy；旧manifest无字段时关闭，显式启用事件幂等且不重写旧manifest。

## 验收

1. 同一工具建立“作品目录”和“居民自定比较指标”，结果按各自原文定义产生，不新增机构类型。
2. 私有view和私有源任一无权均返回统一not-found；计数/聚合不能泄漏；撤回权限即停止查询。
3. 过滤、派生、排序、聚合、分页、稳定同分、空集合、除零/溢出、深度/节点/扫描限额具有业务断言。
4. 查询不改变余额、库存、身体或共享记录；不存在全社会默认分数。
5. 版本冲突、停用、历史、旧manifest、启用幂等、重启回放、默认上下文不含完整内容。
6. 编译后的真实CLI/HTTP读取和执行居民定义；Skill含格式、预算和来源说明。
