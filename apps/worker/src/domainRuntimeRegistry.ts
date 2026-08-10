import type {
  BranchPlanRecord,
  CycleActionSimulator,
  CycleRepairPolicy,
  DomainMicroPlanner,
} from '@aivilization/agent-runtime';
import type { WorkerAgentRuntimeResolver } from './agentScheduling';

export type WorkerDomainRuntimeFactoryInput = Parameters<WorkerAgentRuntimeResolver>[0];

export type WorkerDomainRuntimeFactory = (
  input: WorkerDomainRuntimeFactoryInput,
) => readonly DomainMicroPlanner[] | Promise<readonly DomainMicroPlanner[]>;

type StaticWorkerDomainRuntimeRegistration = {
  readonly domain: string;
  readonly microPlanners: readonly DomainMicroPlanner[];
  readonly createMicroPlanners?: never;
};

type FactoryWorkerDomainRuntimeRegistration = {
  readonly domain: string;
  readonly microPlanners?: never;
  readonly createMicroPlanners: WorkerDomainRuntimeFactory;
};

export type WorkerDomainRuntimeRegistration =
  | StaticWorkerDomainRuntimeRegistration
  | FactoryWorkerDomainRuntimeRegistration;

export function createDomainRuntimeResolver(input: {
  readonly registrations: readonly WorkerDomainRuntimeRegistration[];
  readonly simulate: CycleActionSimulator;
  readonly repair?: CycleRepairPolicy;
}): WorkerAgentRuntimeResolver {
  const registrations = normalizeRegistrations(input.registrations);

  return async (context) => {
    const planTokens = buildPlanTokenSet(context.planRecord);
    const microPlanners: DomainMicroPlanner[] = [];

    for (const registration of registrations) {
      if (!planTokens.has(registration.domain)) {
        continue;
      }

      const planners =
        registration.kind === 'static'
          ? registration.microPlanners
          : await registration.createMicroPlanners(context);
      assertHasMicroPlanners(registration.domain, planners);
      microPlanners.push(...planners);
    }

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

type NormalizedRegistration =
  | {
      readonly kind: 'static';
      readonly domain: string;
      readonly microPlanners: readonly DomainMicroPlanner[];
    }
  | {
      readonly kind: 'factory';
      readonly domain: string;
      readonly createMicroPlanners: WorkerDomainRuntimeFactory;
    };

type RawRegistrationShape = {
  readonly domain: string;
  readonly microPlanners?: readonly DomainMicroPlanner[];
  readonly createMicroPlanners?: WorkerDomainRuntimeFactory;
};

function normalizeRegistrations(
  registrations: readonly WorkerDomainRuntimeRegistration[],
): readonly NormalizedRegistration[] {
  const domains = new Set<string>();

  return registrations.map((registrationInput) => {
    const registration = registrationInput as RawRegistrationShape;
    const domain = normalizeDomain(registration.domain);
    if (domain.length === 0) {
      throw new Error('domain runtime registration domain must not be empty');
    }
    if (domains.has(domain)) {
      throw new Error(`duplicate domain runtime registration ${domain}`);
    }
    const hasStaticMicroPlanners = registration.microPlanners !== undefined;
    const hasFactory = registration.createMicroPlanners !== undefined;
    if (hasStaticMicroPlanners && hasFactory) {
      throw new Error(
        `domain runtime registration ${domain} cannot define both microPlanners and createMicroPlanners`,
      );
    }
    if (!hasStaticMicroPlanners && !hasFactory) {
      throw new Error(
        `domain runtime registration ${domain} requires microPlanners or createMicroPlanners`,
      );
    }

    domains.add(domain);
    if (hasStaticMicroPlanners) {
      const microPlanners = registration.microPlanners;
      assertHasMicroPlanners(domain, microPlanners);
      return {
        kind: 'static',
        domain,
        microPlanners,
      };
    }

    const createMicroPlanners = registration.createMicroPlanners;
    if (createMicroPlanners === undefined) {
      throw new Error(
        `domain runtime registration ${domain} requires microPlanners or createMicroPlanners`,
      );
    }
    return {
      kind: 'factory',
      domain,
      createMicroPlanners,
    };
  });
}

function assertHasMicroPlanners(
  domain: string,
  microPlanners: readonly DomainMicroPlanner[],
): void {
  if (microPlanners.length === 0) {
    throw new Error(`domain runtime registration ${domain} requires at least one micro-planner`);
  }
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
