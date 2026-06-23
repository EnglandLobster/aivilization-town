import type { AgentRuntimeModuleStatus } from '@aivilization/agent-runtime';
import type { CommodityConfig } from '@aivilization/content';

export * from './commandDispatch';
export * from './agentScheduling';
export * from './agentCycleRunner';
export * from './canonicalActivePlanTick';
export * from './canonicalDomainRuntimes';
export * from './canonicalWorkerRuntimeResolver';
export * from './domainRuntimeRegistry';
export * from './localRuntimeStorage';
export * from './memoryConsolidation';
export * from './projectionHydration';
export * from './steering';
export * from './tickRunner';

export type WorkerBootContract = {
  readonly agentRuntime: AgentRuntimeModuleStatus;
  readonly commodityCount: number;
  readonly commoditySample?: CommodityConfig;
};
