# Canonical来源世界到分区计算的实际交接

本切片组合既有迁移权威与分区端口，不复制社会聚合、不新增居民能力。原25项及完整R01仍保留。

## 边界

来源为已完成单机自由机会的真实社会journal。取得唯一writer锁、确认无未完成turn后才建立静态计算归属；按居民ID稳定分配两个计算分区，不把计算分组解释成社会关系。启动服务前后全部世界/社会状态和journal保持不变，新增绑定/凭据仅是基础设施事实。

原opencode目录的历史证据和CLI会话标记按字节复制到对应计算目录，先核对最新权威turn中实际sessionId。只在同一主机的现有供应商会话存储上验收；不声称已跨主机迁移供应商数据库。不得改写旧observed-session的scope或补造供应商观察。新turn实际返回sessionId必须与其原会话相等，否则报告未完成交接，保留已经发生的事实。

两个独立计算客户端经各自分区凭据领取原居民机会；服务端只接受当前短期本人令牌。所有CLI事实仍提交同一journal。首次验收按轮换调用有限机会，保证每个分区有真实完成调用；等待不计机会，不绕过全局时钟屏障，也不强行唤醒居民。此方式验证多计算分区交接，不冒充多个模型同时在途或物理多机。

## 验证

记录启用前完整状态、manifest、历史journal摘要；拒绝存在活跃轮次或不匹配会话标记。核对启动不产生社会事件、两端真实身份归属、自然任务标记、实际供应商版本/Skill/session、CLI调用事实、前缀与全状态回放。达到每分区至少一次完成后收口；总调用预算或错误触发停止，保留完整失败，不自动重试模型。

下一层仍包括真实并发在途、故障接管、长期分区循环、物理多机及所有资源责任跨运行模式；不得以本切片完成宣称整个R01完成。


## 首次实际验收（已终止，失败保留）

`apps/residents/scripts/verify-canonical-partition-handoff.mjs`已通过格式/lint并从实际revision756启动。输出目录`.local/canonical-cutover-20261007/partition-handoff-1`，先保存完整before-state、核对25名居民最新权威session与原CLI标记，再按每份文件摘要复制历史证据。启动两分区服务前后完整状态与journal相等；此后claim才允许原调度推进。

进程session49901，日志`/tmp/canonical-partition-handoff.log`；运行中不能覆盖编译文件、重启native daemon或把旧副本视为新的世界。`verification.json`仅在服务/子进程完成并回放核验后生成。当前没有宣称session连续性或两分区交接已完成；分区归属配置已在原权威持久绑定，后续启动必须使用同一归属或明确实现迁移。


首次运行最终停在revision763：p2居民已提交4项真实操作，供应商导出显示助手完成，但客户端没有收到结构化完成事件并在300秒后退出。失败、实际行动和完整回放均保留于`evidence/SOCIETY_CANONICAL_PARTITION_HANDOFF_FAILURE_2026-10-07.json`。上述session49901已终止，不是当前运行。

## 供应商工作目录身份修复

旧adapter从证据目录计算供应商工作目录，搬迁证据会改变工作目录却继续传入旧session。现将两者分开：CLI会话标记增加可选workspaceId；旧标记按原算法恢复身份，必须匹配实际sessionId。标识只接受32位小写十六进制，不能指定任意路径。

交接先按字节复制证据，再持久保存内容寻址的来源证明（原标记精确字节及摘要、来源与目标、session、workspace），最后更新目标活动标记。源文件与旧observed-session不改写；重试核对证明。后续provider证据同时记录工作目录身份，真实完成时核对session和workspace。供应商内部丢失输出的具体机制尚未直接观测，不能仅凭此推断全部超时原因。

修复已通过lint、全仓排序typecheck、residents及依赖build，全仓3306通过/1原跳过；11项针对测试覆盖旧标记兼容、跨目录续接、错误session/非法标识拒绝和分区客户端。第二次实际验收从revision763开始，目录`partition-handoff-2`，保持原静态分区归属，继续下一个自然机会，不重放失败轮次；真实结果以该目录verification.json为准，尚未据此宣称成功。


## 第二次真实结果（已终止）

revision763→783，原session与workspace均保留，实际收到73项结构化事件。居民持续查询并实际出行，最后成功提交schedule.wait；14次step_finish均为tool-calls，没有观察到最终stop，达到原300秒上限后SIGTERM。与首次零事件故障不同，不能把它归因于同一目录问题，也不能把已收到事件当作整轮完成。两分区完成目标未达到，未自动重试。历史前缀、manifest、全状态回放全部相等；证据见`evidence/SOCIETY_PROVIDER_WORKSPACE_HANDOFF_2026-10-07.json`。

下一步先检查最后供应商完成边界与等待动作后的调度语义，区分有效长推理和客户端未退出；不以增加工具、加长超时或伪造完成绕过。整体能力地图与R01完整范围保持不变。

供应商独立export核验：40条消息，末条assistant没有finish/completed且没有parts，前一条为schedule.wait的tool-calls。这次没有发现供应商已完成但adapter未收尾的证据；不修改完成判断、不增加超时。下一验收继续原世界783之后的自然机会，不重复已提交的行动，保留两次失败前缀。

## 原世界两端完成（第三段验收）

原revision783→801，p2居民014与p1居民017均completed，实际供应商session与workspace身份连续。启动状态不变，原失败及全部历史前缀保留，manifest不变，全组合状态回放一致。见`evidence/SOCIETY_CANONICAL_PARTITION_HANDOFF_2026-10-07.json`。这证明同主机两分区轮换计算交接；不证明模型同时在途、长期稳定、孤儿接管或物理多机。前两段失败仍单独报告，不能拼成无故障运行。
