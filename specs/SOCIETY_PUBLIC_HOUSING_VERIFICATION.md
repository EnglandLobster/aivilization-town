# 公共住房收费与准入制度：H2验收

完成的是明确初始授权范围内的收费与升级准入制度，不是完整住房或全部社会能力。总边界见[SOCIETY_HOUSING_BOUNDARIES_V1.md](SOCIETY_HOUSING_BOUNDARIES_V1.md)。

society拥有版本化publicHousing聚合；governance拥有初始授权、独立表决和执行；world将二者原子绑定。启用保留原价格/准入、居民等级、全部欠费和资产，单独记录旧强制降级阈值的来源。新模式只累计未来欠费，停止旧自动降级并清债。新制度执行后才影响未来费用；旧manifest和事件继续原语义。

新CLI `governance housing`按需分页，支持历史revision查询；通用propose/vote/close/execute执行封闭set-housing内容。不能注入身体、产权、私人租金、债务豁免或未注册等级。普通上下文仅增加查询指针。原housing.standard也显示实际使用的制度版本。

验证：

- 10项领域/world/runtime测试；包含真实私人租约在公共收费改为零后仍继续收租，押金及住房事实不变。
- `pnpm check`：lint、全仓typecheck和2808项测试通过，1项跳过；404测试文件通过。
- 全传递依赖build通过；认证HTTP/编译CLI19次调用，5次预期拒绝，身份注入、提前执行、旧版本和非法字段均拒绝；事件回放与旧manifest字节一致。
- 独立部署全部硬链接拆开；371个运行代码/包元数据指纹，部署的居民包自引用也指向冻结根目录。冻结CLI再次通过。
- free-384旧状态经新引擎完整回放一致后，journal2891/2892只启用H1/H2。原manifest和原implementation不变，所有居民事实、活动、安排、资产和欠费不变。

第一次全仓检查发现CLI路由计数断言仍为374，更新为实际375；新增私人租约组合测试后修正fixture的可选位置类型，最终全门槛通过。没有削弱领域拒绝条件。

仅开放实验的精确时间模式已接入；不支持滞后分桶结算，避免历史套新价。初始服务费用仍归外部模型供给，不伪造开发商收入。实际建筑服务、公产建设、债务救济、全运行模式及长期自由证据继续开发。机器证据见[evidence/SOCIETY_PUBLIC_HOUSING_2026-10-06.json](evidence/SOCIETY_PUBLIC_HOUSING_2026-10-06.json)。
