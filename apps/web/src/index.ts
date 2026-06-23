import type { AgentCycleTrace } from '@aivilization/observability';

export type WebInspectionPanelContract = {
  readonly selectedTrace?: AgentCycleTrace;
  readonly showsPlannerInternals: true;
};
