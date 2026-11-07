# 协作元能力 v1 实施契约

这是已经实现的协作切片，属于[社会总 Spec](AGENT_DRIVEN_SOCIETY_V1.md)的一部分，不代表全社会能力已经完成。实际工程与模型证据见[切片验收报告](AGENT_DRIVEN_SOCIETY_V1_VERIFICATION.md)。

## 1 共同记录（information）

register 保存 id、ownerId、title、visibility、readers、editors、字段类型定义、revision、可选接任者。字段为有限的 string/number/boolean，拒绝未知字段、非有限数值、原型保留名、嵌套对象和过大数据；这是存储契约，不是对社会语义的分类。

record 保存 registerId、key、values、revision、createdBy、editedBy、authorityId、at。保留每次完整版本。values 永远是居民陈述；author/executor/authority 由系统填写，不接收模型伪造。

owner 可修改读取/编辑授权；授予编辑权不等于对方加入组织或同意章程。editor 可维护条目；读写均重新检查当前 ACL。owner 通过 nominate/accept 完成双方确认的权限交接，旧 owner 是否继续有权取决于显式 ACL。关闭/撤下条目使用有版本的 tombstone，不抹历史。

列表默认返回元数据，正文/values 按需展开。公开 register 的可见性不代表其记录已经被验证。

## 2 居民流程（collaboration）

program 是不可变版本序列：id、ownerId、title、purpose（原文）、runners、steps、revision、at。owner 修订生成新版本；旧版本和授权保留为审计资料，不再执行。可停用，不能删除历史。

每个 step 明确 principalId、capability 和 arguments。v1 可自动执行的能力为：`payments.transfer`、`records.put`、`records.append`、`messages.send`。它们覆盖跨账户真实效果、共同信息和通知。append 由运行 ID 与步骤序号生成稳定条目 key，支持重复流程不覆盖既往记录；put 固定预期版本，冲突时必须由居民重新处理。其他能力仍可由居民本人通过现有 CLI 操作；未列入自动执行白名单不是居民禁止使用。

这不是任意脚本环境：无 eval、网络、宿主文件、循环、动态权限参数、模型内嵌判断或嵌套 program。流程声明就是有限、完整、可审查的计划，不从自然语言推断步骤。居民可以建立不同流程并自行选择；扩展自动执行能力必须先证明领域授权和原子性。

manual run 仍需每个 principal 的明确 mandate，包括作者自己的资源。runner 不能借“我是发起人”花别人钱。所有步骤先在临时状态上通过各领域公开决策函数计算，任一步失败则丢弃全部拟执行效果。不得把跨多天的物理活动伪装成瞬间原子步骤。

## 3 有限授权（collaboration）

mandate：id、principalId、runnerId、programId、programRevision、maxRuns、usedRuns、expiresAt、revoked、revision。创建时绑定现存精确版本，principal 必须是步骤的资源主体，runner 必须在该版本名单中。一次流程里同一主体的所有步骤是一份整体授权；总支出上限由固定步骤金额之和 × maxRuns 明确给出。

不能更改授权参数以扩大权限；需要撤销并建立新授权。撤销立即阻止后续执行；成功运行才消耗一次使用额度。每次运行重新验证最新 ACL、余额和主体存在。权限不能被二次转授，授权人无权授出的能力也不能经代理获得。

多个候选授权按稳定 ID 选择；CLI 返回实际使用的授权 ID。授权过期时间为半开边界，at >= expiresAt 无效。授权不锁住钱，执行时可能因余额不足失败。若居民需要真实锁定，继续使用既有押金/订单机制。

## 4 模拟时间自动执行

schedule 由 runner 本人创建，绑定 program 精确版本，startAt、intervalMs、remainingRuns 均有上限；创建时检查当前授权足以启动，但未来效果仍须执行时校验。v1 仅支持模拟时间触发，无全城事件订阅和任意条件解释。

每个到期点按 time、schedule ID 确定性处理；同一时刻既有 world 时间效果和租约/出行先结算，再执行程序。不会因推进大步而合并有状态调用。失败写 run 记录并停止该 schedule，不暗中反复尝试；runner 可查询原因后明确建立新计划。

每次时间推进预先检查最大到期次数，超出整个推进拒绝，不截掉中间执行；调用者可分段推进。新增计划还检查所有拟执行时刻的同时到期数，不能制造通过分段也无法推进的过载时刻。到期执行与同一推进的世界事件在一个 journal 事务中提交。取消只能影响未来，不撤销已发生效果。

## 5 规则目录

rules list/read 为只读说明，覆盖所有能力类别并区分 integrity、world-model、initial-institution、resident-institution、interpretation。目录不是新的权威公式来源；真实数值读取现有 policy/manifest 和 world 查询。

每项包括说明、领域归属、能力入口、版本来源、变更权与限制。没有治理入口时明确标为本版固定，不能声称所有制度均可被居民重写。程序、共同记录及其权限的启用由 manifest 决定。记录社会含义的目录不能自动赋予该含义客观效力。

## 6. 预算、持久化与兼容

新能力通过可选 `societyKernelPolicy` 显式启用；新实验默认启用，旧 manifest 缺字段时关闭，旧 journal 可原样重放。支持创建新实验以及单次幂等 opt-in；不覆写旧 manifest，不对历史虚构共同记录或授权。

policy 默认上限：每位 owner 20 个 register / 20 个 program；每 register 1000 条记录、16 个字段；文本单元 2000 字符、整条 values 序列化最大8000字符，保证单条可在默认结果预算内展开；每程序最多8步、10个 runner、8个 principal；程序序列化最大12000字符；每份授权最多100次、最长30模拟日；每主体最多100份活跃授权；每 runner 最多20个活跃 schedule；间隔至少1模拟分钟、单计划最多100次；每次推进最多128次到期执行。拒绝使用稳定 reason，不能静默裁剪写入。

历史事实只追加；活动额度限制不等于删除历史。规模上当前为内存 projection + 单写入 journal；历史增长和索引成本必须在长期实验报告中量化。

新增 sharedRecordsEvents、coordinationEvents 均为 optional，旧 reducer 状态无字段时兼容。所有事件含最终事实和版本；回放不重新运行规则、不发送消息、不重新扣款。新流程能力不改变 canonical planner、分区 authority 或旧领域事件含义。

## 7. 感知与行动交付

- 默认上下文只增加固定长度的能力入口/启用状态，不注入全城 register、grant、program 或流程正文。
- 完整数据按需 CLI 查询；分页默认10、最大30，排序稳定，返回 total/offset；历史也分页。
- 程序参与者的真实执行结果成为可检索经历。只报告本人授权/步骤的相关信息和流程结果，不泄漏其他人的余额、私密记录和认知。
- 未读提醒与通知不得把居民强行改成同意、信任或履约。授权自动执行是事先确认的程序，不是一次新的 LLM 决策。
- read 返回原文/数据而非系统摘要。曾读数据可能留在供应商会话历史，当前 ACL 只能限制新的读取。
- Skill 新增元能力与规则说明页；既有生成器是唯一来源。CLI JSON 参数有明确帮助和示例，保留受限命令执行器。
