import type { AgentRuntimeModuleStatus } from '@aivilization/agent-runtime';
import type { CommodityConfig } from '@aivilization/content';

export * from './commandDispatch';
export * from './agentCycleRunner';
export * from './localRuntimeStorage';
export * from './projectionHydration';
export * from './steering';
export * from './tickRunner';

export type WorkerBootContract = {
  readonly agentRuntime: AgentRuntimeModuleStatus;
  readonly commodityCount: number;
  readonly commoditySample?: CommodityConfig;
};
