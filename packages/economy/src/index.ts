export * from './amm';
export * from './inventory';
export * from './production';

export type EconomyModuleStatus = {
  readonly packageName: '@aivilization/economy';
  readonly owns: 'commodities-production-markets';
};
