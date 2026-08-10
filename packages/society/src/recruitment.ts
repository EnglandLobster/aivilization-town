export type RecruitmentApplication = {
  readonly applicationId: string;
  readonly agentId: string;
  readonly occupationName: string;
  readonly educationScore: number;
  readonly residentialTier: number;
  readonly submittedAt: number;
};

export type RecruitmentCyclePolicy = {
  readonly policyVersion: string;
  readonly cycleDurationMs: number;
  readonly defaultOccupationCapacity: number;
  readonly occupationCapacityOverrides: Readonly<Record<string, number>>;
};

export type RecruitmentApplicationResolutionStatus = 'accepted' | 'rejected';

export type RecruitmentResolutionReason =
  | 'competitive-match'
  | 'capacity-exhausted'
  | 'agent-matched-elsewhere';

export type RecruitmentApplicationResolution = {
  readonly applicationId: string;
  readonly agentId: string;
  readonly occupationName: string;
  readonly status: RecruitmentApplicationResolutionStatus;
  readonly reason: RecruitmentResolutionReason;
};

export type RecruitmentCycleDecision = {
  readonly acceptedApplications: readonly RecruitmentApplication[];
  readonly resolutions: readonly RecruitmentApplicationResolution[];
};

export function calculateRecruitmentCycleNumber(input: {
  readonly simulationTime: number;
  readonly cycleDurationMs: number;
}): number {
  assertNonNegativeFinite(input.simulationTime, 'simulationTime');
  assertPositiveFinite(input.cycleDurationMs, 'cycleDurationMs');
  return Math.floor(input.simulationTime / input.cycleDurationMs);
}

export function calculateCompletedRecruitmentCycleNumbers(input: {
  readonly previousSimulationTime: number;
  readonly nextSimulationTime: number;
  readonly cycleDurationMs: number;
}): readonly number[] {
  assertNonNegativeFinite(input.previousSimulationTime, 'previousSimulationTime');
  assertNonNegativeFinite(input.nextSimulationTime, 'nextSimulationTime');
  assertPositiveFinite(input.cycleDurationMs, 'cycleDurationMs');
  if (input.nextSimulationTime < input.previousSimulationTime) {
    throw new Error('nextSimulationTime must be greater than or equal to previousSimulationTime');
  }

  const firstCompletedBoundary =
    Math.floor(input.previousSimulationTime / input.cycleDurationMs) + 1;
  const lastCompletedBoundary = Math.floor(input.nextSimulationTime / input.cycleDurationMs);
  if (firstCompletedBoundary > lastCompletedBoundary) {
    return [];
  }
  return Array.from(
    { length: lastCompletedBoundary - firstCompletedBoundary + 1 },
    (_, index) => firstCompletedBoundary + index - 1,
  );
}

export function resolveRecruitmentCycle(input: {
  readonly applications: readonly RecruitmentApplication[];
  readonly policy: RecruitmentCyclePolicy;
}): RecruitmentCycleDecision {
  validateRecruitmentPolicy(input.policy);
  validateApplications(input.applications);

  const preferencesByAgent = new Map<string, RecruitmentApplication[]>();
  for (const application of input.applications) {
    const preferences = preferencesByAgent.get(application.agentId) ?? [];
    preferences.push(application);
    preferencesByAgent.set(application.agentId, preferences);
  }
  for (const preferences of preferencesByAgent.values()) {
    preferences.sort(compareApplicationPreference);
  }

  const nextPreferenceIndex = new Map<string, number>();
  const heldByOccupation = new Map<string, RecruitmentApplication[]>();
  const queue = [...preferencesByAgent.keys()].sort((left, right) => left.localeCompare(right));

  while (queue.length > 0) {
    const agentId = queue.shift();
    if (agentId === undefined) {
      break;
    }
    const preferences = preferencesByAgent.get(agentId) ?? [];
    const preferenceIndex = nextPreferenceIndex.get(agentId) ?? 0;
    const proposal = preferences[preferenceIndex];
    if (proposal === undefined) {
      continue;
    }
    nextPreferenceIndex.set(agentId, preferenceIndex + 1);

    const capacity = resolveOccupationCapacity(input.policy, proposal.occupationName);
    const candidates = [...(heldByOccupation.get(proposal.occupationName) ?? []), proposal].sort(
      compareEmployerPreference,
    );
    const retained = candidates.slice(0, capacity);
    const rejected = candidates.slice(capacity);
    heldByOccupation.set(proposal.occupationName, retained);

    for (const rejectedApplication of rejected) {
      if (
        (nextPreferenceIndex.get(rejectedApplication.agentId) ?? 0) <
        (preferencesByAgent.get(rejectedApplication.agentId)?.length ?? 0)
      ) {
        queue.push(rejectedApplication.agentId);
      }
    }
  }

  const acceptedApplications = [...heldByOccupation.values()].flat().sort(compareResolutionOrder);
  const acceptedIds = new Set(acceptedApplications.map((application) => application.applicationId));
  const acceptedAgentIds = new Set(acceptedApplications.map((application) => application.agentId));
  const resolutions = [...input.applications].sort(compareResolutionOrder).map((application) => {
    if (acceptedIds.has(application.applicationId)) {
      return {
        applicationId: application.applicationId,
        agentId: application.agentId,
        occupationName: application.occupationName,
        status: 'accepted',
        reason: 'competitive-match',
      } as const;
    }
    return {
      applicationId: application.applicationId,
      agentId: application.agentId,
      occupationName: application.occupationName,
      status: 'rejected',
      reason: acceptedAgentIds.has(application.agentId)
        ? 'agent-matched-elsewhere'
        : 'capacity-exhausted',
    } as const;
  });

  return { acceptedApplications, resolutions };
}

function resolveOccupationCapacity(policy: RecruitmentCyclePolicy, occupationName: string): number {
  return policy.occupationCapacityOverrides[occupationName] ?? policy.defaultOccupationCapacity;
}

function compareApplicationPreference(
  left: RecruitmentApplication,
  right: RecruitmentApplication,
): number {
  return (
    left.submittedAt - right.submittedAt || left.applicationId.localeCompare(right.applicationId)
  );
}

function compareEmployerPreference(
  left: RecruitmentApplication,
  right: RecruitmentApplication,
): number {
  return (
    right.educationScore - left.educationScore ||
    right.residentialTier - left.residentialTier ||
    left.submittedAt - right.submittedAt ||
    left.agentId.localeCompare(right.agentId) ||
    left.applicationId.localeCompare(right.applicationId)
  );
}

function compareResolutionOrder(
  left: RecruitmentApplication,
  right: RecruitmentApplication,
): number {
  return (
    left.occupationName.localeCompare(right.occupationName) ||
    compareEmployerPreference(left, right)
  );
}

function validateRecruitmentPolicy(policy: RecruitmentCyclePolicy): void {
  if (policy.policyVersion.trim().length === 0) {
    throw new Error('recruitment policyVersion must not be empty');
  }
  assertPositiveFinite(policy.cycleDurationMs, 'recruitment cycleDurationMs');
  assertNonNegativeInteger(
    policy.defaultOccupationCapacity,
    'recruitment defaultOccupationCapacity',
  );
  for (const [occupationName, capacity] of Object.entries(policy.occupationCapacityOverrides)) {
    if (occupationName.trim().length === 0) {
      throw new Error('recruitment occupation capacity name must not be empty');
    }
    assertNonNegativeInteger(capacity, `recruitment capacity for ${occupationName}`);
  }
}

function validateApplications(applications: readonly RecruitmentApplication[]): void {
  const applicationIds = new Set<string>();
  const agentOccupations = new Set<string>();
  for (const application of applications) {
    assertNonEmpty(application.applicationId, 'applicationId');
    assertNonEmpty(application.agentId, 'agentId');
    assertNonEmpty(application.occupationName, 'occupationName');
    assertNonNegativeFinite(application.educationScore, 'educationScore');
    assertPositiveInteger(application.residentialTier, 'residentialTier');
    assertNonNegativeFinite(application.submittedAt, 'submittedAt');
    if (applicationIds.has(application.applicationId)) {
      throw new Error(`duplicate recruitment application id ${application.applicationId}`);
    }
    applicationIds.add(application.applicationId);
    const agentOccupation = `${application.agentId}\u0000${application.occupationName}`;
    if (agentOccupations.has(agentOccupation)) {
      throw new Error(
        `duplicate recruitment application for ${application.agentId} and ${application.occupationName}`,
      );
    }
    agentOccupations.add(agentOccupation);
  }
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be non-negative`);
  }
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be positive`);
  }
}
