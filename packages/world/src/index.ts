export * from './agentActions';
export * from './commands';
export * from './events';
export * from './projection';
export * from './regionalMarkets';
export * from './spatial';
export * from './weather';

export type WorldModuleStatus = {
  readonly packageName: '@aivilization/world';
  readonly owns: 'server-authoritative-command-event-projection';
};
