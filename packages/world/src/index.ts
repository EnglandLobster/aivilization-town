export * from './agentActions';
export * from './bulletin';
export * from './commands';
export * from './conflict';
export * from './credit';
export * from './events';
export * from './enterprise';
export * from './economicPolicies';
export * from './matters';
export * from './projection';
export * from './regionalMarkets';
export * from './renewableResources';
export * from './serviceQuality';
export * from './spatial';
export * from './townPulse';
export * from './weather';

export type WorldModuleStatus = {
  readonly packageName: '@aivilization/world';
  readonly owns: 'server-authoritative-command-event-projection';
};

export * from './residentCommerce';
export * from './residentParticipation';
export * from './residentLeases';

export * from './residentMobility';
