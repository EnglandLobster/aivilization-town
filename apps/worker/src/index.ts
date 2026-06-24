import type { AgentRuntimeModuleStatus } from '@aivilization/agent-runtime';
import type { CommodityConfig } from '@aivilization/content';

export * from './commandDispatch';
export * from './actionSynthesisPolicy';
export * from './agentScheduling';
export * from './agentCycleRunner';
export * from './canonicalActivePlanTick';
export * from './canonicalDomainRuntimes';
export * from './canonicalWorkerRuntimeResolver';
export * from './domainRuntimeRegistry';
export * from './economicRuntime';
export * from './localRuntimeStorage';
export * from './marketMetrics';
export * from './memoryConsolidation';
export * from './objectiveLifecycle';
export * from './objectiveRenewal';
export * from './projectionHydration';
export * from './steering';
export * from './tickRunner';
export * from './wagePolicy';
export * from './worldCommandPolicySource';

export type WorkerBootContract = {
  readonly agentRuntime: AgentRuntimeModuleStatus;
  readonly commodityCount: number;
  readonly commoditySample?: CommodityConfig;
};
