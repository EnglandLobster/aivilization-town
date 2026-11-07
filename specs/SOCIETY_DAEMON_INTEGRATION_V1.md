# 完整社会的显式常驻运行模式

本切片推进R01：原常驻server只组装canonical planner；开放居民run/serve另行持有journal。采用显式`resident-society`子命令，把完整OpenSocietyRuntime、认证HTTP/CLI、受限OpenCode、轮次/模拟时间和退出恢复接入同一个正式server可执行入口，不把WorldEvent复制到另一套状态。旧默认canonical入口保持不变；本步骤不是跨主机/分区完成。

## 运行与归属

执行`node apps/server/dist/localRuntimeTownCliMain.js resident-society --root DIR --port 4320 --model PROVIDER/MODEL`。DIR必须是已显式初始化的开放社会；本模式不播种、不从canonical目录猜测迁移、不修改旧manifest、不启用遗漏的可选制度。使用全部原capability catalog和领域编排，已启用/未启用仍按原manifest/启用事件判断。

apps/residents的daemon仅编排已有应用入口与供应商，既有runtime仍是全部社会聚合的权威。apps/server新增对residents adapter的单向依赖，以复用真实认证服务器、受限shell与模型driver；domain不依赖apps，residents不反向依赖server。没有新世界命令、制度或Agent任务。HTTP常态上下文/按需CLI和供应商历史语义不变，不广播全城状态。

调度沿实际nextResident公平顺序与真实nextWake/提醒/活动边界；无可用居民时只推进到已记录未来边界，每次至多一天。成功轮次按manifest原opportunityCadenceMs推进。没有未来可推进边界时返回idle，不能自造居民或虚构任务。测试可设max-opportunities，未设置持续运行；它是运行预算而非居民目标。

模型只获本人连接与context，使用既有town CLI。daemon掌管轮次和时间时，原管理员start/finish/advance HTTP拒绝并说明daemon-owns-scheduling；管理员仍可看报告，居民仍不能冒充actor。一个journal锁阻止第二writer。

## 中断与恢复

每轮起止和供应商失败使用原Runtime持久语义，重复请求仍沿原requestId结果。已有running轮次重用原turn，不能用重启创造第二次扣款；供应商会话ID/受限本地会话目录沿原实现保留。失败停止运行并保留失败，不隐藏重试或用新任务覆盖原交接。SIGINT/SIGTERM先向driver发abort，等待原driver退出、记录结果，再关闭HTTP和journal；重复stop共用一个关闭过程。基础设施错误保持失败退出，半截日志走已有显式recover-journal，不在启动时静默修复。

## 验证与剩余范围

工程验收使用受控driver但真实认证HTTP：两居民独立原文与存款；禁止居民管理和管理员调度竞争；提供者失败停止；实际abort与写锁释放；中断轮次及存款requestId恢复；全状态重放、manifest不变；非法CLI输入。另以编译server主入口和真实OpenCode自由轮次验证启动/调用/停止，此为新目录的短自由运行，不与冻结992机会历史混合，也不把成功运行当稳定组织证据。

canonical旧planner数据迁移、旧Web/participant界面适配、跨分区完整提交与投递确认仍未完成。此次使正式可执行入口能运行完整社会，不能据此把全部R01标为已验收。下一步在此完整权威之上接分区调度/所有权与可靠投递，保持原25项范围。

## 真实运行反馈与修复

新目录的首次短自由运行中，一名居民正常结束，另一名在180秒预算超时；daemon以非零退出并保留事实。显式300秒续跑的三个机会均正常完成，但供应商会话核对发现首次失败后的sessionId被重建，验收保持失败。这不是世界状态丢失：旧driver只在completed时写cli-session.json，却已把失败会话ID存入journal。重启没有可信transport标记，遂另开会话。

修复为：只要本次受限CLI进程真实报告了sessionId，成功或失败都保存当前transport来源；续接仍要求版本与所请求ID严格相符，不根据任意参数继承旧MCP会话。旧成功会话兼容，过去已丢失的标记不伪造补写。新增真实子进程协议测试与真实OpenCode中断验收：查询提交后中断，重启runtime/server/provider，再次查询沿同一sessionId，世界状态不变且完整重放一致。后者为提示式故障验收，不能取代自由社会证据；原自由运行的超时和会话重建永久保留。

自由运行还发现world.observe labor/business.services未启用；代码支持、当前运行配置启用、模型实际采用是三件事。后续应同时核对显式完整能力配置与分区接线，不能继续扩展单点容错而忽视大量已实现能力仍休眠。默认180秒未改，300秒只是记录在验收中的显式预算。

## 最终工程门槛与证据

8项新测试，全仓3148通过/1原跳过，lint、全仓排序typecheck、最终residents typecheck、相关build、格式与diff检查通过。两类真实模型证据分别保存：正式入口短自由运行累计5机会（4完成/1超时），首次失败后的旧会话重建检查为失败；修复后的独立真实中断/重启验证同sessionId续接、原世界不变与完整重放。不能将前者改判成功，也不能把后者当自然社会。

失败报告曾在早期断言退出后仍固定打印manifestAndPriorPrefixUnchanged=true；验证器现已改成实际检查后赋值，历史报告该字段不采用。额外独立回读确认manifest等于原确定性种子、全部旧轮次（含失败）未改写，证据单列。详见`evidence/SOCIETY_DAEMON_INTEGRATION_2026-10-07.json`。

下一步优先整理并验收显式完整能力运行配置：从实际拒绝看到已有能力尚未启用，这比继续深化单机失败处理更直接影响社会可用性；随后沿完整组合权威接分区调度与可靠投递。旧manifest不自动升级，R01与全部25项仍未完成。
