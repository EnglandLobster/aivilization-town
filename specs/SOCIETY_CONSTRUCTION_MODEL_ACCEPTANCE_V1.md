# 工程交易的真实模型可用性验收

本文件属于G03/W02/W05/R02的局部证据，不关闭25项总目标。工程约定与真实施工规则见`archive/SOCIETY_CONSTRUCTION_PROCUREMENT_V1.md`。

## 验收边界

`apps/residents/scripts/verify-construction-trade-opencode.mjs`使用真实OpenCode、`opencode-go/deepseek-v4.1-flash`、身份绑定的town CLI与HTTP，在独立`.local/open-residents/construction-trade-opencode-20261007`运行。工程起点由验收脚本通过权威命令实际供料、保留和创建，初始同地/材料是明确测试种子，不计作模型行为。模型接到明确的交易目标与价格30；自行查帮助、组装参数、写条款和执行，不能算自主选中该合作或自由组织形成。

没有给模型业务MCP或操作者API。每轮均有独立本人身份；验收者只在本人开始工作后推进实际模拟时间，不代报价、接受或付款。

## 观察到的事实

四轮全部provider completed：施工者报价，买方本人独立接受，施工者本人开始实际劳动，真实480000毫秒后查询完工并结算。订单从offered到funded再到completed；30由买方钱包进入托管，完成后进入施工者钱包。未付款时不劳动，尚未推进时间时无建筑；实际完工记录8单位Wood投入。货币供给保持初始值，重开完整journal状态一致且日志字节未变。

四轮模型耗时合计209576毫秒；82次CLI工具执行，78次退出0、3次退出1、1次退出2。36次实际认证能力调用（不含turn.finished），33成功、3拒绝。计数不能把provider completed等同于每次命令成功。

4次错误均保留且模型自行修正：

- 报价payer误用主体`kind:resident`，应为账户`sector:agent`，被精确codec拒绝。
- 买方先查旧`orders read`，该目录找不到此工程订单；随后使用principals入口。
- 将内部操作`construction-trades.accept`当独立capability查询，被拒绝；实际入口是principals.operate。
- 结算时猜测不存在的`town construction-trades read`命令，退出2；随后查帮助继续。

模型用了town find和原始平台指南，没有人工插入修正命令。此样本证明可自行完成，不证明最优认知成本、低错误率或其他模型一定成功。不同订单目录和嵌套账户类型是具体摩擦，保留为共用入口评估依据；本轮不因此新增一组工具、自动猜意图或放宽账户校验。

267份编译JS在模型运行前后哈希相同。后续配置发布发生在模型结束之后，不把此模型样本冒充新版完整配置的自由运行。

## 下一落点与停止局部递归

通过后将既有能力纳入显式`society-integrated-v2`配置，只增加constructionTrade开关和对应公共授权；v1和已有manifest不被替换。配置工程验收与模型样本分别取证。随后回到R01/R02整体组合与不同条件的自由观察，再按事实缺口选择长期责任/清算或生活供给；不继续扩展工程评分、招标或承包商制度。canonical/分区、完整公共与集体模型合作和全25项验收仍未完成。

完整证据见`evidence/SOCIETY_CONSTRUCTION_MODEL_2026-10-07.json`，包括原始轮次哈希、3个业务拒绝、1个本地命令错误和供应商用量遥测。用量/费用为provider上报值，不作为独立核验账单。
