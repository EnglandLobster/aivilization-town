# 完整开放配置 v2

归属worker composition root，复用既有领域启用事件，不新增社会制度或默认Agent目标。入口为`pnpm residents init --root NEW_DIR --profile society-integrated-v2 --count N --initialization settled|newcomers`。

v2在v1固定功能清单上仅显式启用constructionTrade，与`public-construction-trade-v1`公共采购范围一起进入新manifest。v1名称、特性清单、工厂默认值和不指定profile的旧初始化保持原语义；旧目录不重写。已存在的实验可另走明确`enable-construction-trade`事件，不通过换profile覆盖初始事实。非法profile、与legacy冲突或非init使用在打开目录前拒绝。

集成测试核对v1无建设订单/采购grant，v2具有空订单与正确版本；两者居民资产、premises初始事实、moneySupply、treasury一致。实际v2运行推进900000毫秒后重开完整状态和journal相同，没有预建订单或社团。新profile无法覆盖旧v1目录，原manifest和状态仍可原样重开。

本发布依据建设运行/编译CLI及真实提示式模型验收，分别见`SOCIETY_CONSTRUCTION_PROCUREMENT_V1.md`与`SOCIETY_CONSTRUCTION_MODEL_ACCEPTANCE_V1.md`。模型验收使用显式工程配置而非完整v2；后续v2已完成settled/newcomers两组共32次自由机会及正常重启/传输回放核验，见`SOCIETY_V2_CONDITIONS_AND_RESTART_V1.md`。短观察不等于稳定社会。canonical/分区所有能力、长期义务/完整清算与原25项仍保留。

本轮止于显式配置接入与验证。下一工作重心回到R01/R02整体组合与不同条件自由观察；不追加施工评分、自动承包人选择、招标制度或强制集体。

最终检查：新增2项配置测试，全仓3207通过/1原跳过、481文件通过/1原跳过；lint、排序全仓typecheck、residents及依赖构建通过。真实编译CLI在新目录完成8项验证。初次负例测试的any返回lint问题修正并保留日志，未放宽断言。见`evidence/SOCIETY_INTEGRATED_PROFILE_V2_2026-10-07.json`。
