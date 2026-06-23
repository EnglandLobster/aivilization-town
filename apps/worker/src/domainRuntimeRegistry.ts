import type {
  BranchPlanRecord,
  CycleActionSimulator,
  CycleRepairPolicy,
  DomainMicroPlanner,
} from '@aivilization/agent-runtime';
import type { WorkerAgentRuntimeResolver } from './agentScheduling';

export type WorkerDomainRuntimeRegistration = {
  readonly domain: string;
  readonly microPlanners: readonly DomainMicroPlanner[];
};

export function createDomainRuntimeResolver(input: {
  readonly registrations: readonly WorkerDomainRuntimeRegistration[];
  readonly simulate: CycleActionSimulator;
  readonly repair?: CycleRepairPolicy;
}): WorkerAgentRuntimeResolver {
  const registrations = normalizeRegistrations(input.registrations);

  return ({ planRecord }) => {
    const planTokens = buildPlanTokenSet(planRecord);
    const microPlanners = registrations.flatMap((registration) =>
      planTokens.has(registration.domain) ? registration.microPlanners : [],
    );

    if (microPlanners.length === 0) {
      return undefined;
    }

    return {
      microPlanners,
      simulate: input.simulate,
      ...(input.repair === undefined ? {} : { repair: input.repair }),
    };
  };
}

type NormalizedRegistration = {
  readonly domain: string;
  readonly microPlanners: readonly DomainMicroPlanner[];
};

function normalizeRegistrations(
  registrations: readonly WorkerDomainRuntimeRegistration[],
): readonly NormalizedRegistration[] {
  const domains = new Set<string>();

  return registrations.map((registration) => {
    const domain = normalizeDomain(registration.domain);
    if (domain.length === 0) {
      throw new Error('domain runtime registration domain must not be empty');
    }
    if (domains.has(domain)) {
      throw new Error(`duplicate domain runtime registration ${domain}`);
    }
    if (registration.microPlanners.length === 0) {
      throw new Error(`domain runtime registration ${domain} requires at least one micro-planner`);
    }

    domains.add(domain);
    return {
      domain,
      microPlanners: registration.microPlanners,
    };
  });
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase();
}

function buildPlanTokenSet(record: BranchPlanRecord): ReadonlySet<string> {
  const tokens = new Set<string>();
  addTextTokens(record.plan.objective, tokens);

  for (const branch of record.plan.branches) {
    addTextTokens(branch.id, tokens);
    addTextTokens(branch.objective, tokens);

    for (const subtask of branch.subtasks) {
      addTextTokens(subtask.id, tokens);
      addTextTokens(subtask.description, tokens);
      addTagTokens(subtask.intentionAffinityTags, tokens);
      addTagTokens(subtask.memoryAffinityTags, tokens);
      addTagTokens(subtask.profileAffinityTags, tokens);
    }
  }

  return tokens;
}

function addTagTokens(tags: readonly string[] | undefined, tokens: Set<string>): void {
  for (const tag of tags ?? []) {
    addTextTokens(tag, tokens);
  }
}

function addTextTokens(text: string, tokens: Set<string>): void {
  for (const token of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (token.length > 0) {
      tokens.add(token);
    }
  }
}
