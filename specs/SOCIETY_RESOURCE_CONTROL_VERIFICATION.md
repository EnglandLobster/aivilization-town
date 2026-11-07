# 信息资源控制切片验收（M06/M09，2026-10-05）

space/register/view完成工程验收；完整M06/M09仍保留群组、服务、车辆、设施、企业、长期义务与整体清算。这里没有把信息空间当作真实房屋，没有真实模型调用，也没有自然涌现结论。

新增authority纯领域包：个人/集体Controller、独立接受的版本化offer、过期/撤回、当前管理员校验；没有资产余额、成员名单、网络或world依赖。information单向依赖authority，资源本体和使用ACL仍在各自聚合。可选control覆盖旧ownerId授权，缺少control的旧事件保持原个人语义；新控制快照记录policyVersion。

个人提出交接，目标个人亲自接受或目标集体按自己的程序接受；拒绝/错版/撤回不消费集体决定。资源事件与集体决定消费同次提交。collectiveResources统一编排各资源端口；共同账户仍走world守恒记账，信息资源只发信息领域事件。成员身份不能直接作为集体管理权。ACL独立于controller，不把新管理成员自动加入群组或赋予私文读取权。

新增5项authority、6项information、6项runtime测试：个人旧行为、双方同意、错误身份/证明/版本/期限/预算、旧创建者失去隐含权限、原始作者与新修改者分离、管理设置使旧offer失效、视图定义实际作者/决定出处、封闭操作拒绝任意金额/作者改写、个人到集体到继任个人的完整链路、决定消费原子一次、撤回后旧决定不消费、真实读写ACL及非成员使用权、控制改变阻断旧条件响应、旧manifest幂等启用与逐字节回放。既有共同账户/集体/边界回归亦通过。

`pnpm check`通过：lint、全仓有序typecheck、2340项测试通过、1项既有跳过；318个文件通过、1个跳过。residents及全部依赖build通过，包括新增authority。当前249项能力/48组/79页Skill，版本resource-control-v1、open-capabilities-v15、town-resident-skill-v14、society-rulebook-v7。

真实编译CLI/HTTP验收30次：独立成员投票、个人与集体接管分离、旧创建者不能恢复ACL、使用授权不制造成员资格、共享记录原创建者与实际编辑者保持真实、集体转交个人需本人接受、原管理成员失去权限、重启state与journal字节相等。证据：[SOCIETY_RESOURCE_CONTROL_2026-10-05.json](evidence/SOCIETY_RESOURCE_CONTROL_2026-10-05.json)；脚本apps/residents/scripts/verify-resource-control.mjs。

当前通用管理操作是space/register配置ACL、view修改/停用；不开放万能set-owner或原文冒名改写。resources元数据查询与实际内容读取分开；底层files、records、views、传播、条件执行统一使用当前ACL。默认上下文仅入口，具体交接与控制回执按需读取。尚未接入的群组/其他资产及跨资产清算继续实施；canonical/分区与真实Agent组合仍由R01/R02验收。
