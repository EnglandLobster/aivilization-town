import type { AgentRuntimeModuleStatus } from '@aivilization/agent-runtime';
import type { CommodityConfig } from '@aivilization/content';

export * from './steering';

export type WorkerBootContract = {
  readonly agentRuntime: AgentRuntimeModuleStatus;
  readonly commodityCount: number;
  readonly commoditySample?: CommodityConfig;
};
