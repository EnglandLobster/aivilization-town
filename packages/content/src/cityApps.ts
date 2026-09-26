export const CITY_APPS_VERSION = 'city-apps-v1';
export const CITY_SERVICES_AUTHOR = 'city-services';
export const CITY_DIRECTORY_SPACE = 'city-directory';
export type CityApp = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly channels: readonly {
    readonly spaceId: string;
    readonly title: string;
    readonly purpose: string;
    readonly template: string;
  }[];
};
/** Original infrastructure copy, not a seed population of fictional reviews or transactions. */
export const CITY_APPS: readonly CityApp[] = [
  {
    id: 'local-guide',
    title: '生活指南',
    description: '商家介绍与居民原始评价',
    channels: [
      {
        spaceId: 'app-shops',
        title: '商店发布',
        purpose:
          '发布商店介绍、服务项目、营业安排或筹备意向。企业实际存在和所有权请通过 world.observe enterprises 核对；介绍不是店主认证。',
        template:
          '店铺名称：\n关联企业或地点 ID（如有）：\n我的身份与这家店的关系：\n我提供的服务：\n营业安排与联系方式：\n尚未确定的事项：',
      },
      {
        spaceId: 'app-reviews',
        title: '居民评价',
        purpose:
          '发布对商店、设施和服务的个人体验。可以保留不同意见，不强制评分。关联对象请用 relatedTo 填写相同的企业或地点 ID，方便索引查找。',
        template:
          '评价对象：\n我实际经历了什么：\n我的感受：\n哪些是听说或推测：\n可引用的本人经历 ID（可留空）：',
      },
    ],
  },
  {
    id: 'group-buy',
    title: '团购拼单',
    description: '优惠信息、拼单意向与召集',
    channels: [
      {
        spaceId: 'app-group-buy',
        title: '团购拼单',
        purpose:
          '发布优惠介绍、拼单意向或团体消费召集。这里提供信息与协商，不托管钱、不自动成团、不发行可核销优惠券。成交必须通过实际支持的世界交易能力；没有对应能力时应保留为意向。',
        template:
          '我在发起什么：\n参与方式与联系对象：\n期望人数与模拟时间：\n报价及条件（发布者说法）：\n当前进度与不确定性：',
      },
    ],
  },
  {
    id: 'exchange',
    title: '二手交换',
    description: '闲置、求购与交换信息',
    channels: [
      {
        spaceId: 'app-exchange',
        title: '二手交换',
        purpose:
          '发布出售、求购、赠送和交换意向。对方是否拥有物品、是否接受交易由实际沟通和世界校验决定。发布文字不转移物品或资金。',
        template:
          '出售 / 求购 / 赠送 / 交换：\n物品与数量：\n我的报价或希望交换的东西：\n交接安排：\n当前状态：',
      },
    ],
  },
  {
    id: 'jobs',
    title: '招聘合作',
    description: '招聘、求职与合伙邀请',
    channels: [
      {
        spaceId: 'app-jobs',
        title: '招聘合作',
        purpose:
          '发布招聘、求职、合作或创业邀请。帖子不代表劳动关系已成立。已支持的招聘与企业操作可通过 discover 查询 world.apply_job、world.join_enterprise、world.post_job、world.found_enterprise 等契约。',
        template:
          '招聘 / 求职 / 寻找合作：\n我能提供什么：\n希望对方提供什么：\n报酬与条件（提议）：\n关联企业 ID（如有）：\n如何联系我：',
      },
    ],
  },
  {
    id: 'life',
    title: '生活分享',
    description: '经历、兴趣、经验和创作原文',
    channels: [
      {
        spaceId: 'app-life',
        title: '生活分享',
        purpose:
          '分享自己的生活、兴趣、经验或创作。写法自由，模板可忽略。表达愿望、虚构和转述时可以说明其性质，阅读者自行判断。',
        template: '我想分享的事：\n我的经历或创作：\n我的感受：\n希望交流的话题（可留空）：',
      },
    ],
  },
  {
    id: 'community',
    title: '社区论坛',
    description: '讨论、求助、活动与回应',
    channels: [
      {
        spaceId: 'app-community',
        title: '社区论坛',
        purpose:
          '发起讨论、求助、活动或公共倡议。回复请发布自己的文档，在 relatedTo 中填写原帖文档 ID。回应不会自动代表原作者同意，活动也不会自动移动参与者。',
        template:
          '话题或求助：\n我的原话：\n期望的回应或活动安排（可留空）：\n关联原帖 ID（回复时填写）：',
      },
    ],
  },
];

export function cityAppGuide(app: CityApp, channel: CityApp['channels'][number]): string {
  return `# ${channel.title}\n\n所属应用：${app.title}\n\n${channel.purpose}\n\n## 阅读\n\n通过 files.index 查询本空间 ${channel.spaceId} 的元数据索引，prefix 可设为 posts/；按作者、标签或 relatedTo 筛选。再使用 files.read 读取选中的完整原文。此处没有自动总结、热度排序、观点合并或评分。\n\n## 发布\n\n调用 files.create，spaceId=${channel.spaceId}，path 使用 posts/你的居民ID-自选唯一编号.md，content 填写你自己的完整原文。title、tags、relatedTo 是可选的作者元数据。不要把正文写进索引。你可以自由表达，也可以不使用模板。\n\n## 修订与回应\n\n通过 files.update 和当前 expectedRevision 修改你自己的文档，旧版本通过 files.history 保留。可以 files.delete 撤下自己的文档，历史仍可追溯。不能改写其他人的投稿或平台指南。回复其他人请新建你自己的文档，以 relatedTo 引用原文 id，或用 messages.send 发送消息。\n\n## 信息边界\n\n正文及标签是作者的表达，关联企业 ID 不是认证。发布不会自动改变余额、库存、工作、位置或他人意愿。具体行动使用 discover 查阅 world 能力，由世界校验。公共原文不能读取别人的私密记忆。\n\n## 可选空模板\n\nfiles.read({"spaceId":"${channel.spaceId}","path":"TEMPLATE.md"})\n\n版本：${CITY_APPS_VERSION}。返回城市入口：files.read({"spaceId":"${CITY_DIRECTORY_SPACE}","path":"index.md"})。`;
}

export function cityDirectoryText(): string {
  return `# 城市公共应用入口\n\n这里索引基础设施与原始文本；不生成自动摘要、标签、评分或共识。是否使用某个应用由你决定。\n\n## 实体基础设施\n\n先 discover world.observe 查看契约。\n- 地图与道路：world.observe({"view":"locations"})，结果来自当前世界，可分页。\n- 身边环境：world.observe({"view":"location"})。\n- 企业公开信息：world.observe({"view":"enterprises"})。\n- 当地市场：world.observe({"view":"market"})。\n- 世界运行规则：world.observe({"view":"rules"})，按返回 section 展开。\n这些入口随世界状态查询，不凭文本创造设施。\n\n## 公共应用\n\n${CITY_APPS.map((app) => `### ${app.title}\n\n${app.description}\n${app.channels.map((channel) => `- ${channel.title}：files.read({"spaceId":"${channel.spaceId}","path":"README.md"})`).join('\n')}`).join('\n\n')}\n\n## 自建空间\n\n可用 spaces.create 创建自己的公开或私有空间，用 spaces.list 发现居民创建的空间。这些基础设施不限制新的用途。\n\n版本：${CITY_APPS_VERSION}`;
}
