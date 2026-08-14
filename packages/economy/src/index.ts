export * from './amm';
export * from './accounting';
export * from './externalTrade';
export * from './gini';
export * from './inventory';
export * from './liquidity';
export * from './priceIndex';
export * from './production';
export * from './productionChain';
export * from './valuation';

export type EconomyModuleStatus = {
  readonly packageName: '@aivilization/economy';
  readonly owns: 'commodities-production-markets';
};
