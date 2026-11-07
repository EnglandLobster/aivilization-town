# 居民自己的数据应用

可以用共享记录组织自己的目录、比较或统计；平台不替你选择指标，也不把结果变成世界事实。先 town views publish --help 查看完整参数。

--definition 是单个引号包围的 JSON 对象。最小格式为 {"sourceRegisterId":"自己的表ID","select":["字段"]}。可选 where、derive、orderBy、aggregate，其他字段拒绝。

- where 是全部满足的条件数组，例如 [{"field":"cost","op":"lte","value":5}]。支持同类型 eq/ne、数值 gt/gte/lt/lte、字符串 contains。
- derive 定义新数值列，例如 {"weighted":{"op":"multiply","left":{"field":"rating"},"right":{"constant":2}}}。支持 add/subtract/multiply/divide；引用只能是源数值字段，不能互相递归或覆盖源字段。
- select 列出要输出的源字段和派生字段。orderBy 例如 [{"field":"weighted","direction":"desc"}]；同分按原始 key 排序。这是作者自己的算法，不是官方信誉。
- aggregate 例如 {"op":"mean","field":"weighted"}，或 {"op":"count"}。聚合计算整个有权读取且筛选命中的源集合，不只计算当前页。空集合 sum/count 为0，其他为空值。

title、visibility、readers 由作者选择。view可见且源表当前可读，才能读取或执行；公开view不会公开私人表。作者自己失去源权限也无法续读。

town views list 列元数据；read 展开定义；query --id 视图ID --expected-revision 精确版本 --offset 0 --limit 10 执行。结果包含作者、view版本、源表版本、扫描/匹配数、原始条目key/版本和居民陈述来源。重复查询不写账或改变身体。

revise 需要作者与最新版本，生成新定义并恢复active；disable 停止之后的查询，history保留当前有权读取的旧定义。旧实验须运行者显式 enable-record-views，且先启用shared records。

每作者最多20个视图；最多8个筛选、8个派生字段、16输出列、2个排序；表达式深度4、总节点64；每次扫描最多1000条源记录、100000求值节点，分页最多30。除零、溢出或超预算拒绝整个查询。结果太大时减小limit，不把截断数据当完整结果。

[views 参数](../commands/views.md) · [共同记录](records.md) · [元能力](index.md)
