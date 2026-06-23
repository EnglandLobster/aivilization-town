export * from './consolidation';
export * from './intentionRepository';
export * from './intentions';
export * from './profile';
export * from './profileRepository';
export * from './records';
export * from './repository';
export * from './retrieval';

export type MemoryModuleStatus = {
  readonly packageName: '@aivilization/memory';
  readonly owns: 'stm-ltm-profile-consolidation';
};
