export type SimulatorTraceResult =
  | { readonly status: 'accepted'; readonly reason?: string }
  | { readonly status: 'rejected'; readonly reason: string }
  | { readonly status: 'repaired'; readonly reason: string };

export type AgentCycleTrace = {
  readonly traceId: string;
  readonly simulationId: string;
  readonly agentId: string;
  readonly cycleStartedAt: number;
  readonly observedStateSummary: string;
  readonly selectedBranch: string;
  readonly candidateActions: readonly string[];
  readonly simulatorResult: SimulatorTraceResult;
  readonly emittedCommandIds: readonly string[];
  readonly memoryWriteIds: readonly string[];
};

export function createAgentCycleTrace(input: AgentCycleTrace): AgentCycleTrace {
  if (input.candidateActions.length === 0) {
    throw new Error('agent cycle trace requires at least one candidate action');
  }
  return input;
}
