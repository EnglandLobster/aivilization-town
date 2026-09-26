import { createSeededRandom } from '@aivilization/sim-core';
import type { ScenarioPreset } from './scenarios';
export const RESIDENT_INITIALIZATION_VERSION = 'resident-initialization-v2';
const interests = [
  '喜欢安静地阅读',
  '喜欢做饭与分享食物',
  '对手工和修理有兴趣',
  '爱逛街看新鲜事',
  '偏爱运动与户外活动',
  '喜欢音乐和创作',
  '喜欢研究生意与价格',
  '珍惜独处时间',
];
const tendencies = [
  '遇到新事通常先观望',
  '有时会先尝试再考虑',
  '花钱时倾向谨慎',
  '愿为自己喜欢的体验多花一点',
  '比较在意自己的边界',
  '在意别人如何看待自己',
];
const contact = [
  '不急于扩大交际圈',
  '有时愿意主动认识人',
  '更喜欢少数熟人的往来',
  '是否交往取决于当时的心情和经历',
];
/** Initial conditions, not fabricated autobiographical events or mandatory personality rules. */
export function initializeResidentPopulation(
  preset: ScenarioPreset,
  seed: string,
  mode: 'settled' | 'newcomers',
  maximum = 100,
) {
  const rng = createSeededRandom(`${RESIDENT_INITIALIZATION_VERSION}:${seed}`);
  const pick = (items: readonly string[]) => items[Math.floor(rng.nextFloat() * items.length)]!;
  const backgrounds: Record<string, string> = {};
  const acquaintances: Record<string, readonly string[]> = {};
  const agentSeeds = preset.agentSeeds.map((agent, index) => {
    backgrounds[agent.agentId] =
      `初始化设定（不是实际运行经历）：${pick(interests)}；${pick(tendencies)}；${pick(contact)}。这些只是起点，你可以改变看法，也没有指定的任务或成功标准。`;
    acquaintances[agent.agentId] =
      mode === 'settled' && preset.agentSeeds.length > 1
        ? [
            ...new Set([
              preset.agentSeeds[(index + preset.agentSeeds.length - 1) % preset.agentSeeds.length]!
                .agentId,
              preset.agentSeeds[(index + 1) % preset.agentSeeds.length]!.agentId,
            ]),
          ]
        : [];
    const job =
      mode === 'settled' && rng.nextFloat() < 0.7
        ? agent.educationScore >= 13 && rng.nextFloat() > 0.5
          ? 'Waiter'
          : 'Cleaner'
        : null;
    return {
      ...agent,
      physiology: { energy: maximum, satiety: maximum, health: maximum },
      ...(mode === 'settled'
        ? {
            job,
            balance: 300 + Math.floor(rng.nextFloat() * 500),
            inventory: { Apple: 4 + Math.floor(rng.nextFloat() * 5) },
          }
        : {}),
      source: RESIDENT_INITIALIZATION_VERSION,
    };
  });
  return { preset: { ...preset, agentSeeds }, backgrounds, acquaintances };
}
