export * from './amm';
export * from './inventory';
export * from './priceIndex';
export * from './production';
export * from './valuation';

export type EconomyModuleStatus = {
  readonly packageName: '@aivilization/economy';
  readonly owns: 'commodities-production-markets';
};
