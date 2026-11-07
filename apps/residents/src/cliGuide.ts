/**
 * A plain-language map of the town CLI for residents. The catalog describes each command
 * precisely, in terms of authority and evidence; this says what each group is for in everyday words
 * and arranges the groups by area of life, so a resident can find, say, "hire someone" without
 * knowing that it lives under `business`. It changes no rule and grants nothing; order is by area,
 * not a recommendation of what to do.
 */
export type CliGuideArea = {
  readonly title: string;
  readonly groups: readonly { readonly group: string; readonly plain: string }[];
};
export const CLI_GUIDE_AREAS: readonly CliGuideArea[] = [
  {
    title: '看看自己和周围',
    groups: [
      { group: 'city', plain: '看自己的状态、所在地点、身边的人、市场行情和规则' },
      { group: 'memory', plain: '搜索、阅读自己的经历' },
      { group: 'cognition', plain: '写下或修改自己的目标、想法和笔记' },
      { group: 'schedule', plain: '决定何时再醒来、给自己设提醒、把几步自己的动作排成计划' },
      { group: 'rules', plain: '查看世界规则，以及哪些能力在这里已经启用' },
    ],
  },
  {
    title: '身体与日常生活',
    groups: [
      { group: 'travel', plain: '去别的地方' },
      { group: 'life', plain: '吃东西、使用自己的物品、睡觉、看医生、提前醒来或停工' },
      { group: 'housing', plain: '查看、选择、升级住处，或自己盖住房' },
      { group: 'education', plain: '学习、停止学习、报名考试' },
    ],
  },
  {
    title: '工作与生产',
    groups: [
      {
        group: 'business',
        plain: '打工、领工资、求职；开公司、加入、注资、招人（招聘时写明工资）、裁人、关闭',
      },
      { group: 'sources', plain: '查看哪里有可以采集的原料' },
      { group: 'production', plain: '采集原料、查配方、加工制作，可以和别人一起做' },
      { group: 'stocks', plain: '建立和管理自己的库存，存取物品，把物品交给别人' },
      { group: 'materials', plain: '把库存里的材料留给某个用途或某个人' },
    ],
  },
  {
    title: '钱与交易',
    groups: [
      { group: 'market', plain: '和外部市场买卖，把东西送给别人，进出口' },
      { group: 'bank', plain: '存钱、取钱、借钱' },
      { group: 'offers', plain: '公开发布你要卖的东西或服务' },
      { group: 'orders', plain: '按别人的报价下单、付款、交付、确认、退款，钱先放在托管里' },
      { group: 'payments', plain: '直接给某人转账，或向几个人收分摊的钱' },
      { group: 'deposits', plain: '锁定一笔押金，之后退还或付给对方' },
    ],
  },
  {
    title: '交流与信息',
    groups: [
      { group: 'messages', plain: '给某位居民发私信、读消息' },
      { group: 'groups', plain: '建群、邀请、加入、在群里说话' },
      { group: 'spaces', plain: '建立公开或私密的信息空间' },
      { group: 'files', plain: '写文档、读文档、搜索文档' },
      { group: 'notifications', plain: '设置私信是否叫醒你、在上下文里显示哪些提醒' },
      { group: 'blocks', plain: '屏蔽某位居民' },
      { group: 'proposals', plain: '向几个人提出具体条款，等他们各自同意' },
      { group: 'commitments', plain: '记录自己对约定的履行、争议或解除' },
    ],
  },
  {
    title: '组织与公共事务',
    groups: [
      { group: 'collectives', plain: '和别人组成集体：起草章程、加入、提案、投票、执行决定' },
      { group: 'funds', plain: '集体控制的共同账户：开户、出资、查账' },
      { group: 'registers', plain: '建立大家共用的登记表，约定谁能写' },
      { group: 'records', plain: '在登记表里写入、修改、查看记录' },
      { group: 'programs', plain: '把几步操作写成可以重复执行的流程' },
      { group: 'mandates', plain: '授权别人按流程替你执行其中几步' },
      { group: 'governance', plain: '公共事务：查看住房和就业规则，提案、投票、异议、执行' },
      { group: 'principals', plain: '查看、操作公司或集体等名下资源的管理事项' },
      { group: 'resources', plain: '管理你控制的资源，把控制权交给别人' },
    ],
  },
  {
    title: '空间与建设',
    groups: [
      { group: 'sites', plain: '查看可以盖房子的空地' },
      { group: 'construction', plain: '规划、建造新建筑，参与施工' },
      { group: 'premises', plain: '管理建好的房产：开放、关闭、转让、拆除回收' },
    ],
  },
];

/** Commands most lives touch, by area. Details and flags: `town <group> <operation> --help`. */
export const EVERYDAY_COMMANDS: readonly { readonly route: string; readonly plain: string }[] = [
  { route: 'city observe', plain: '看自己和周围的情况' },
  { route: 'memory search', plain: '回想自己的经历' },
  { route: 'cognition update', plain: '记下或修改目标和想法' },
  { route: 'schedule wait', plain: '结束这次机会，等到某个时间或有事发生' },
  { route: 'schedule plan', plain: '把几步自己的动作排成计划，依次执行' },
  { route: 'travel go', plain: '去某个地方' },
  { route: 'life eat', plain: '吃自己有的食物' },
  { route: 'life sleep', plain: '睡觉' },
  { route: 'education study', plain: '学习' },
  { route: 'business work', plain: '做工作挣钱' },
  { route: 'business apply-job', plain: '申请工作' },
  { route: 'business found', plain: '开一家公司' },
  { route: 'business post-job', plain: '为公司招人' },
  { route: 'sources list', plain: '看哪里有原料' },
  { route: 'production recipes', plain: '看能做出什么、需要什么' },
  { route: 'production gather', plain: '采集原料' },
  { route: 'production create', plain: '准备加工一批东西' },
  { route: 'production start', plain: '动手干活，直到做完或到时间' },
  { route: 'stocks create', plain: '建一个自己的库存' },
  { route: 'market trade', plain: '和外部市场买卖' },
  { route: 'market give', plain: '把东西送给别人' },
  { route: 'offers publish', plain: '公开卖东西或服务' },
  { route: 'orders create', plain: '向别人的报价下单' },
  { route: 'payments transfer', plain: '给别人转账' },
  { route: 'messages send', plain: '给某人发私信' },
  { route: 'groups create', plain: '建一个群' },
  { route: 'proposals create', plain: '向几个人提出约定' },
  { route: 'collectives create', plain: '和别人组成集体' },
  { route: 'governance propose', plain: '提出公共事务提案' },
  { route: 'construction plan', plain: '算一算盖一座建筑需要什么' },
];

/** The plain line for one group, if it has one. */
export function groupPlain(group: string): string | undefined {
  for (const area of CLI_GUIDE_AREAS)
    for (const entry of area.groups) if (entry.group === group) return entry.plain;
  return undefined;
}
/** The `town help` overview: areas with their groups, then everyday commands. */
export function cliOverview(): string {
  const areas = CLI_GUIDE_AREAS.map(
    (area) => `${area.title}: ${area.groups.map((g) => g.group).join(', ')}`,
  ).join('\n');
  const everyday = EVERYDAY_COMMANDS.map((c) => `town ${c.route} — ${c.plain}`).join('\n');
  return `Groups by area (town help <group>; what each is for: town wiki capabilities.md):\n${areas}\nEveryday commands (flags: town <group> <operation> --help):\n${everyday}`;
}
/** The Skill capability index: every group with a plain line, by area. */
export function capabilityIndexPage(): string {
  const areas = CLI_GUIDE_AREAS.map(
    (area) =>
      `## ${area.title}\n\n${area.groups.map((g) => `- [${g.group}](commands/${g.group}.md)：${g.plain}。\`town help ${g.group}\``).join('\n')}`,
  ).join('\n\n');
  const everyday = EVERYDAY_COMMANDS.map((c) => `- \`town ${c.route}\`：${c.plain}`).join('\n');
  return `# 能力索引\n\n按生活领域排列，每个分类可以单独查询。这里只说明用途，不代表这些能力在你的世界里都已启用，也不是建议你做什么。\n\n${areas}\n\n## 常用命令\n\n${everyday}\n\n每条命令的参数：\`town <分类> <操作> --help\`。\n\n[应用](apps/index.md) · [入口](SKILL.md)\n`;
}
