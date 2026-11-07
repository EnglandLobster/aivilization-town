# 周期责任：私人能力与公共授权分离

状态：本切片工程、编译CLI与canonical来源世界显式迁移已验证；完整长期责任与全模式仍未完成。属于 M03/M06/M09/W05/W06/G01/R01，不替代25项总合同。

## 实际触发与根因

canonical来源的自由世界在394号提交查询 `obligations.list` 被拒绝，模块尚未启用。现有CLI与commerce聚合均已存在，但world的旧启用事件同时扩张公共grant，且所有后续私人结算也要求该grant存在。这把私人双方同意与公共制度权限混在了一起。不能仅为消除查询拒绝运行旧启用命令。

公共就业是另一件事：其启用继承原招聘政策，并明确授予公共修改该制度的范围。该行为保留明确运行者来源，不应伪装为与私人合同相同的无公共授权接入。

## 最小权威边界

- commerce继续拥有原协议、逐期事实、独立同意、终止和既有金额算法；不复制或放松这些规则。
- world拥有新的显式集成策略 `independent-periodic-access-v1`，分离“已接入私人责任端口”与“具有公共范围”。不用领域金融policy版本冒充公共授权版本。
- 新启用事件在不存在账簿时通过commerce公开event applier创建空账簿；已存在时保留全部合同、未付期次、授权、责任和旧公共范围。它不增加公共grant，不创建合同、不补扣历史款、不改变模拟时钟。
- 旧 `ResidentPeriodicObligationsCommitted` 启用事件与旧manifest保持原解释。只有新显式策略存在时，私人操作与到期结算才不依赖公共grant；旧模式仍按旧约束回放。
- 国库账户始终需要既有独立公共授权；没有grant不能读取为可用资金、签国库合同或结算国库出入。个人/企业/共同账户继续使用所属端口及逐方真实授权。
- 新运行者入口可重试，居民活跃轮次中拒绝；居民复用现有CLI，不增加工具或默认正文。当前策略在主动规则查询可见。

## 验收与接入顺序

先验证无政府的私人双方承诺和实际到期资金转移、余额/库存守恒、明确公共拒绝、完整回放；再验证旧启用、旧合同/未付期次/共同账户/企业/退出责任不变。公共grant不能因新接入扩大或缩小。错误事件和失败命令必须原子拒绝。

接入开放runtime、CLI、availability及查询，完成lint/排序typecheck/全仓测试/相关build。通过真实编译CLI验收后，才在当前自由段结束、单写入锁空闲时显式迁移canonical来源世界；原manifest、所有非目标世界字段与历史journal前缀保持。迁移与居民自由采用分别记录，不代居民订合同或制定公共制度。

切片结束即回到完整能力地图。不追加自动追债、利息、信用评分或机构模板；完整长期责任/清算、公共就业接入、全模式和25项原范围继续。


## 当前实现与证据

world新增`ResidentPeriodicAccessEnabled`与可选`periodicAccess`，通过commerce原事件applier建空账簿或保留旧账簿；原公共grant完全不动。运行者`enable-periodic-access`拒绝活跃轮次并支持幂等重试；旧入口保留原语义。canonical组合字段归agreement；Skill v69/规则手册v56通过原主动查询说明边界。

4项新增测试覆盖无政府双方同意/真实到期支付/禁止代人接受/国库不可用/重复时间不重付/守恒回放，以及runtime拒绝活跃轮次/幂等/原manifest、旧生效合同和公共权限完全保留。旧17项周期责任用例继续通过；全仓3303通过/1原跳过（`/tmp/periodic-access-full-tests.log`）。

`apps/residents/scripts/verify-independent-periodic.mjs`已准备并通过lint，尚未执行：须等待冻结的自由续段结束后构建依赖，再运行真实认证CLI闭环。不能将脚本存在算作验收通过。当前续段仍使用Skill v68，不提前替换运行文件；公共就业接入及独立接入后额外公共范围扩展仍需后续独立验收。

全仓lint和排序typecheck最终均通过，日志`/tmp/periodic-access-lint3.log`与`/tmp/periodic-access-typecheck3.log`；未覆盖运行中的编译文件。


迁移验收脚本 `apps/server/scripts/verify-canonical-periodic-access.mjs` 已准备并通过lint，验证所有非目标world字段、非world社会状态、原manifest/历史日志前缀、单次启用和重复执行/回放；仍未在实际世界执行。

公共就业的独立审查已在revision577的精确历史副本完成（`apps/worker/scripts/verify-canonical-public-employment.mjs`，本地报告`.local/canonical-cutover-20261007/public-employment-rehearsal.json`）：canonical来源招聘条款/周期/version一致，原申请/资产/社会记录不变，仅增加明确set-employment公共授权，幂等与回放成立。这是隔离工程演练，不是当前世界启用、更不是居民表决结果。


## 最终接入结果

依赖及居民端正常build通过。真实认证CLI在无政府临时世界执行7次调用、2次预期拒绝：独立双方约定、冒名接受拒绝、无权限国库拒绝、实际到期付款1、原manifest与回放一致。此前脚本准备状态已被这次真实结果替代，见`evidence/SOCIETY_INDEPENDENT_PERIODIC_ACCESS_2026-10-07.json`。

原自由续段在741号提交结束后，741→742仅启用独立周期接入，空协议账簿、原公共grant、全部其他world字段与非world社会状态、原manifest及历史日志前缀保持；重复命令无新提交，回放一致。没有代表居民订协议。

另行742→743启用公共就业：招聘条款/周期/source版本来自原canonical政策，只有明确就业公共授权扩展；原申请、资产、居民记录与manifest不变，没有居民表决或录用。见`evidence/SOCIETY_CANONICAL_PUBLIC_EMPLOYMENT_2026-10-07.json`。独立周期接入没有随此取得公共周期资金权限。

到此停止本切片扩展。两项启用后的自然采用尚未观察；下一步回总能力图，评估自由段已实际暴露的housing-choice接入缺口、完整住房/责任与R01后续集成，原25项目标不变。
