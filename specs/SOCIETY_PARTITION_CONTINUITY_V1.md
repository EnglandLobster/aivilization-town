# 持续分区计算与可恢复交接

本阶段接通常驻分区循环及供应商会话/交接恢复，不增加居民规则。上一阶段已有真实独立计算进程、短期本人令牌和时间屏障；单次入口不能等同于长期运行。

外层运行者轮询claim，waiting仅做可中断的wall-clock退避，不替居民决定下一行动。收到机会后使用原受限OpenCode，不增加任务。完成继续领取；供应商错误或传输错误停止并保留证据，不隐藏重试模型。SIGINT/SIGTERM中止供应商并等待退出。可设置有限机会数验收，默认长期运行。

权威有持久随机计算身份，计算目录绑定权威身份与分区，拒绝其他世界/分区使用。此身份只是基础设施来源，不是居民产权或社会制度；旧manifest不重写。OpenCode首次实际观察到sessionID后原子持久保存当前actor/turn/transport证明，不能猜测ID；会话标记同时写入。解析非JSON诊断可以忽略，持久化失败必须报告并停止供应商，不能吞掉。重复同turn运行证据不得覆盖旧文件。

每次供应商完成先保存本地精确turn/result，再提交finish。finish响应丢失或权威重启后，新令牌重领同一未结束turn时重发原结果，不再调用模型。若已提交wait，则恢复交接而非新行动；若turn仍未结束且已有匹配观察记录，则续接同一供应商会话。未观察到会话ID、计算目录缺失或换主机未迁移证据时不能假称有会话连续性。

本地checkpoint不是领域真相；它不能改变权威返回的actor、turn、时间或原文授权。已结束turn仍由权威journal判断，支付请求仍按原requestId去重。单机文件/进程模型、静态归属和本机HTTP限制仍在；跨主机部署、自动迁移和canonical数据迁移继续总目标。验证需区分受控恢复、真实OpenCode续接和无剧情长程运行。


## 运行入口与证明范围

`pnpm residents partition-daemon --root COMPUTE_DIR --source http://127.0.0.1:4320 --source-credentials FILE --model PROVIDER/MODEL [--max-opportunities N] [--poll-ms 1000]`。既有`partition-run`仍只执行一次。错误配置/凭据/网络错误抛出并退出，模型返回provider-error同样停止；没有隐藏模型重试。等待退避100–60000ms可中断，机会计数不包括等待轮询。

权威`partition-authority-id.json`与原manifest分开，显式分区模式首次创建；计算目录的`partition-worker-binding.json`绑定该ID和分区。先通过只读`/partition/identity`校验本地归属，再提交带期望authorityId的claim；错误目录不会先占住一个轮次。旧单次客户端仍可按原请求形状领取；新持久客户端要求身份查询入口。权威身份、lease和checkpoint是基础设施记录，不参与社会规则或模拟时间公式。

`observed-session.json`包括transport、scope、actor、turn与实际sessionID；`cli-session.json`保留原传输证明。只有当前turn/actor/authority匹配才使用本地观察恢复，源权威已交接的历史sessionID仍按原校验处理。完成记录`partition-result.json`也包含authorityId，先fsync临时文件、rename、同步目录，再提交finish。同turn再次运行的provider证据写入新的attempt文件，原文件不覆盖。损坏checkpoint拒绝，不猜测或删除；没有实际观察的session不得补造。

已完成的受控范围是有序中止供应商、丢失finish提交、重启权威与重放回执后的持续运行。SIGKILL后遗留供应商子进程的安全接管、多主机租约/网络部署、动态归属与canonical旧数据迁移尚未验收，仍属于原R01完整目标；不能把本阶段结果泛化为任意断电或自动failover。


## 验收结果

6项新测试：持续计算与时钟屏障、丢失finish/权威重启后不重复模型或付款、错误停止/可中断等待、跨权威隔离、退出前会话持久化/原证据保留、checkpoint I/O失败不得误报完成。错误目录的最新测试另验证权威revision和turn数不变。全仓3168通过/1原跳过，lint、全仓typecheck与相关build通过。

第一次真实验收已通过，最终入口顺序修正后又在新目录完整复核；旧证据不改。最终目录`.local/open-residents/partition-continuity-20261007-2`，受控中断4548ms，后续两轮92784ms及46288ms，三次供应商尝试同一sessionId，原中断状态保留。finish重发阶段未增加provider证据文件，最终simulationTime=1740000，全状态/日志重放一致。详细报告和源码摘要在`evidence/SOCIETY_PARTITION_CONTINUITY_2026-10-07.json`。计数中的opportunities表示已处理交接机会，不能替代实际provider调用数；恢复旧回执不会冒充一次新模型执行。
