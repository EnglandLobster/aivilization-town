import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cloneSourceRevision, type SourceRevision } from '@aivilization/sim-core';

export const PAPER_AGENT_TRAJECTORY_POLICY_VERSION =
  'paper-agent-trajectory-analysis-v1';
export const PAPER_AGENT_TRAJECTORY_DEFAULT_EARLY_WINDOW_FRACTION = 0.25;
export const PAPER_AGENT_TRAJECTORY_DEFAULT_HIGH_STATUS_MINIMUM_TIER = 5;

const EDUCATION_GUIDANCE_TAGS = new Set([
  'education',
  'knowledge',
  'learn',
  'learning',
  'school',
  'study',
]);
const EDUCATION_GUIDANCE_TEXT_PATTERN =
  /\b(?:education|knowledge|learn|learning|school|study|studying)\b/iu;

export type PaperAgentTrajectoryRun = {
  readonly runId: string;
  readonly simulationId: string;
  readonly runManifestId: string;
  readonly sourceRevision: SourceRevision;
  readonly seed: string;
  readonly experimentStartedAt: number;
  readonly experimentEndedAt: number;
  readonly generatedAt: number;
};

export type PaperAgentTrajectorySnapshot = {
  readonly agentId: string;
  readonly observedAt: number;
  readonly educationScore: number;
  readonly netWorth: number;
  readonly residentialTier: number;
  readonly occupationId?: string;
  readonly occupationTier: number;
};

export type PaperAgentGuidanceObservation = {
  readonly traceId: string;
  readonly commandId: string;
  readonly objectiveId: string;
  readonly planId?: string;
  readonly agentId: string;
  readonly source: string;
  readonly issuedAt: number;
  readonly statement: string;
  readonly affinityTags: readonly string[];
};

export type PaperAgentEducationInvestmentObservation = {
  readonly agentId: string;
  readonly commandId: string;
  readonly eventIds: readonly string[];
  readonly occurredAt: number;
  readonly durationSeconds: number;
  readonly currencyCost: number;
  readonly previousEducationScore: number;
  readonly nextEducationScore: number;
};

export type PaperAgentOccupationTransitionObservation = {
  readonly agentId: string;
  readonly commandId?: string;
  readonly eventId: string;
  readonly occurredAt: number;
  readonly previousOccupationId?: string;
  readonly previousOccupationTier: number;
  readonly nextOccupationId: string;
  readonly nextOccupationTier: number;
};

export type PaperAgentResidentialTransitionObservation = {
  readonly agentId: string;
  readonly commandId?: string;
  readonly eventId: string;
  readonly occurredAt: number;
  readonly previousResidentialTier: number;
  readonly nextResidentialTier: number;
};

export type PaperAgentTrajectoryArtifactInput = {
  readonly run: PaperAgentTrajectoryRun;
  readonly initialSnapshot: readonly PaperAgentTrajectorySnapshot[];
  readonly finalSnapshot: readonly PaperAgentTrajectorySnapshot[];
  readonly guidance: readonly PaperAgentGuidanceObservation[];
  readonly educationInvestments: readonly PaperAgentEducationInvestmentObservation[];
  readonly occupationTransitions: readonly PaperAgentOccupationTransitionObservation[];
  readonly residentialTransitions: readonly PaperAgentResidentialTransitionObservation[];
  readonly earlyWindowFraction?: number;
  readonly highStatusMinimumOccupationTier?: number;
};

export type PaperAgentTrajectoryPolicyManifest = {
  readonly policyVersion: typeof PAPER_AGENT_TRAJECTORY_POLICY_VERSION;
  readonly analysisUnit: 'agent-longitudinal-trajectory';
  readonly planningHorizonProxy: 'early-human-education-long-horizon-objective';
  readonly educationGuidanceClassifier: string;
  readonly educationGuidanceTags: readonly string[];
  readonly earlyWindowFraction: number;
  readonly earlyWindowBoundary: 'experiment-start-inclusive-cutoff-exclusive';
  readonly highStatusMinimumOccupationTier: number;
  readonly outcomes: readonly string[];
  readonly associationMeasures: 'guided-minus-unguided-descriptive-differences';
  readonly initialConditionDisclosure: string;
  readonly causalInterpretation: 'observational-correlation-only';
  readonly causalClaimPermitted: false;
  readonly controlledExperimentRequirement: 'required-for-causal-claims';
  readonly outputFormat: 'immutable-json-plus-human-readable-markdown';
};

export type PaperAgentTrajectoryRow = {
  readonly agentId: string;
  readonly guidedEarly: boolean;
  readonly earlyEducationGuidanceTraceIds: readonly string[];
  readonly earlyEducationObjectiveIds: readonly string[];
  readonly laterEducationGuidanceCount: number;
  readonly firstEarlyGuidanceAt?: number;
  readonly initial: PaperAgentTrajectorySnapshot;
  readonly final: PaperAgentTrajectorySnapshot;
  readonly education: {
    readonly investmentCount: number;
    readonly investmentCountAfterEarlyGuidance: number;
    readonly totalDurationSeconds: number;
    readonly totalCurrencyCost: number;
    readonly scoreDelta: number;
    readonly sourceEventIds: readonly string[];
  };
  readonly mobility: {
    readonly upwardOccupationMobility: boolean;
    readonly highStatusOccupation: boolean;
    readonly occupationTransitionCount: number;
    readonly occupationTransitionEventIds: readonly string[];
    readonly residentialTierDelta: number;
    readonly residentialTransitionCount: number;
    readonly residentialTransitionEventIds: readonly string[];
  };
  readonly wealth: {
    readonly initialNetWorth: number;
    readonly finalNetWorth: number;
    readonly netWorthDelta: number;
  };
};

export type PaperAgentTrajectoryCohortSummary = {
  readonly cohort: 'early-education-guided' | 'not-early-education-guided';
  readonly agentCount: number;
  readonly medianInitialEducationScore: number;
  readonly medianInitialNetWorth: number;
  readonly medianInitialResidentialTier: number;
  readonly educationInvestorCount: number;
  readonly educationInvestmentRate: number;
  readonly medianEducationScoreDelta: number;
  readonly medianFinalEducationScore: number;
  readonly medianFinalNetWorth: number;
  readonly medianNetWorthDelta: number;
  readonly upwardOccupationMobilityCount: number;
  readonly upwardOccupationMobilityRate: number;
  readonly highStatusOccupationCount: number;
  readonly highStatusOccupationRate: number;
  readonly medianResidentialTierDelta: number;
};

export type PaperAgentTrajectoryArtifact = {
  readonly schemaVersion: typeof PAPER_AGENT_TRAJECTORY_POLICY_VERSION;
  readonly run: PaperAgentTrajectoryRun;
  readonly policy: PaperAgentTrajectoryPolicyManifest;
  readonly earlyWindow: {
    readonly startedAt: number;
    readonly endedAtExclusive: number;
    readonly fraction: number;
  };
  readonly sourceRecordCounts: {
    readonly agentCount: number;
    readonly guidanceCount: number;
    readonly educationInvestmentCount: number;
    readonly occupationTransitionCount: number;
    readonly residentialTransitionCount: number;
  };
  readonly cohorts: {
    readonly earlyEducationGuided: PaperAgentTrajectoryCohortSummary;
    readonly notEarlyEducationGuided: PaperAgentTrajectoryCohortSummary;
  };
  readonly descriptiveAssociations: {
    readonly educationInvestmentRateDifference: number;
    readonly medianEducationScoreDeltaDifference: number;
    readonly medianFinalNetWorthDifference: number;
    readonly medianNetWorthDeltaDifference: number;
    readonly upwardOccupationMobilityRateDifference: number;
    readonly highStatusOccupationRateDifference: number;
    readonly interpretation: 'observational-correlation-only';
    readonly causalClaimPermitted: false;
  };
  readonly trajectories: readonly PaperAgentTrajectoryRow[];
  readonly limitations: readonly string[];
  readonly report: {
    readonly filename: 'agent-trajectory-analysis.md';
    readonly mimeType: 'text/markdown';
    readonly markdown: string;
  };
};

export function createPaperAgentTrajectoryPolicyManifest(): PaperAgentTrajectoryPolicyManifest {
  return {
    policyVersion: PAPER_AGENT_TRAJECTORY_POLICY_VERSION,
    analysisUnit: 'agent-longitudinal-trajectory',
    planningHorizonProxy: 'early-human-education-long-horizon-objective',
    educationGuidanceClassifier:
      'human-source-and-education-affinity-tag-or-english-education-keyword',
    educationGuidanceTags: [...EDUCATION_GUIDANCE_TAGS].sort(),
    earlyWindowFraction: PAPER_AGENT_TRAJECTORY_DEFAULT_EARLY_WINDOW_FRACTION,
    earlyWindowBoundary: 'experiment-start-inclusive-cutoff-exclusive',
    highStatusMinimumOccupationTier:
      PAPER_AGENT_TRAJECTORY_DEFAULT_HIGH_STATUS_MINIMUM_TIER,
    outcomes: [
      'education-investment',
      'education-score-change',
      'occupation-mobility',
      'high-status-occupation',
      'residential-tier-change',
      'final-net-worth',
      'net-worth-change',
    ],
    associationMeasures: 'guided-minus-unguided-descriptive-differences',
    initialConditionDisclosure:
      'education-net-worth-residential-tier-and-occupation-preserved-per-agent-and-per-cohort',
    causalInterpretation: 'observational-correlation-only',
    causalClaimPermitted: false,
    controlledExperimentRequirement: 'required-for-causal-claims',
    outputFormat: 'immutable-json-plus-human-readable-markdown',
  };
}

export function createPaperAgentTrajectoryArtifact(
  input: PaperAgentTrajectoryArtifactInput,
): PaperAgentTrajectoryArtifact {
  validateRun(input.run);
  const earlyWindowFraction =
    input.earlyWindowFraction ?? PAPER_AGENT_TRAJECTORY_DEFAULT_EARLY_WINDOW_FRACTION;
  assertFraction(earlyWindowFraction, 'earlyWindowFraction');
  const highStatusMinimumOccupationTier =
    input.highStatusMinimumOccupationTier ??
    PAPER_AGENT_TRAJECTORY_DEFAULT_HIGH_STATUS_MINIMUM_TIER;
  assertOccupationTier(highStatusMinimumOccupationTier, 'highStatusMinimumOccupationTier', false);

  const initialByAgent = createSnapshotMap(
    input.initialSnapshot,
    input.run.experimentStartedAt,
    'initialSnapshot',
  );
  const finalByAgent = createSnapshotMap(
    input.finalSnapshot,
    input.run.experimentEndedAt,
    'finalSnapshot',
  );
  assertMatchingAgentSets(initialByAgent, finalByAgent);

  const earlyWindowEndedAt =
    input.run.experimentStartedAt +
    (input.run.experimentEndedAt - input.run.experimentStartedAt) * earlyWindowFraction;
  const guidanceByAgent = groupGuidance({
    observations: input.guidance,
    run: input.run,
    expectedAgentIds: new Set(initialByAgent.keys()),
    earlyWindowEndedAt,
  });
  const investmentsByAgent = groupEducationInvestments({
    observations: input.educationInvestments,
    run: input.run,
    expectedAgentIds: new Set(initialByAgent.keys()),
  });
  const occupationsByAgent = groupOccupationTransitions({
    observations: input.occupationTransitions,
    run: input.run,
    expectedAgentIds: new Set(initialByAgent.keys()),
  });
  const residencesByAgent = groupResidentialTransitions({
    observations: input.residentialTransitions,
    run: input.run,
    expectedAgentIds: new Set(initialByAgent.keys()),
  });

  const trajectories = [...initialByAgent.keys()]
    .sort((left, right) => left.localeCompare(right))
    .map((agentId) => {
      const initial = initialByAgent.get(agentId)!;
      const final = finalByAgent.get(agentId)!;
      const guidance = guidanceByAgent.get(agentId) ?? { early: [], later: [] };
      const investments = investmentsByAgent.get(agentId) ?? [];
      const occupationTransitions = occupationsByAgent.get(agentId) ?? [];
      const residentialTransitions = residencesByAgent.get(agentId) ?? [];
      return createTrajectoryRow({
        agentId,
        initial,
        final,
        guidance,
        investments,
        occupationTransitions,
        residentialTransitions,
        highStatusMinimumOccupationTier,
      });
    });

  const guidedRows = trajectories.filter((row) => row.guidedEarly);
  const unguidedRows = trajectories.filter((row) => !row.guidedEarly);
  if (guidedRows.length === 0 || unguidedRows.length === 0) {
    throw new Error(
      'paper trajectory analysis requires both early-education-guided and unguided cohorts',
    );
  }
  const guided = createCohortSummary('early-education-guided', guidedRows);
  const unguided = createCohortSummary('not-early-education-guided', unguidedRows);
  const artifactBase: Omit<PaperAgentTrajectoryArtifact, 'report'> = {
    schemaVersion: PAPER_AGENT_TRAJECTORY_POLICY_VERSION,
    run: cloneRun(input.run),
    policy: {
      ...createPaperAgentTrajectoryPolicyManifest(),
      earlyWindowFraction,
      highStatusMinimumOccupationTier,
    },
    earlyWindow: {
      startedAt: input.run.experimentStartedAt,
      endedAtExclusive: earlyWindowEndedAt,
      fraction: earlyWindowFraction,
    },
    sourceRecordCounts: {
      agentCount: trajectories.length,
      guidanceCount: input.guidance.length,
      educationInvestmentCount: input.educationInvestments.length,
      occupationTransitionCount: input.occupationTransitions.length,
      residentialTransitionCount: input.residentialTransitions.length,
    },
    cohorts: {
      earlyEducationGuided: guided,
      notEarlyEducationGuided: unguided,
    },
    descriptiveAssociations: {
      educationInvestmentRateDifference:
        guided.educationInvestmentRate - unguided.educationInvestmentRate,
      medianEducationScoreDeltaDifference:
        guided.medianEducationScoreDelta - unguided.medianEducationScoreDelta,
      medianFinalNetWorthDifference: guided.medianFinalNetWorth - unguided.medianFinalNetWorth,
      medianNetWorthDeltaDifference: guided.medianNetWorthDelta - unguided.medianNetWorthDelta,
      upwardOccupationMobilityRateDifference:
        guided.upwardOccupationMobilityRate - unguided.upwardOccupationMobilityRate,
      highStatusOccupationRateDifference:
        guided.highStatusOccupationRate - unguided.highStatusOccupationRate,
      interpretation: 'observational-correlation-only' as const,
      causalClaimPermitted: false as const,
    },
    trajectories,
    limitations: [
      'Early education guidance is a versioned proxy for planning horizon, not a direct measurement of latent planning ability.',
      'Guided and unguided agents are not randomized; initial conditions and unobserved selection factors may confound every contrast.',
      'The reported differences are descriptive associations and must not be interpreted as treatment effects.',
      'A causal claim requires a pre-registered controlled experiment such as randomized A/B assignment.',
    ],
  };
  const report = renderPaperAgentTrajectoryMarkdown(artifactBase);
  return {
    ...artifactBase,
    report: {
      filename: 'agent-trajectory-analysis.md',
      mimeType: 'text/markdown',
      markdown: report,
    },
  };
}

export class FilePaperAgentTrajectoryArtifactRepository {
  private readonly rootDir: string;

  constructor(input: { readonly rootDir: string }) {
    assertNonEmpty(input.rootDir, 'rootDir');
    this.rootDir = join(input.rootDir, 'paper-agent-trajectory-artifacts');
    mkdirSync(this.rootDir, { recursive: true });
  }

  save(artifact: PaperAgentTrajectoryArtifact): Promise<PaperAgentTrajectoryArtifact> {
    return Promise.resolve().then(() => {
      assertValidArtifact(artifact);
      const artifactDir = this.resolveArtifactDir(artifact.run.runId);
      const manifestPath = join(artifactDir, 'artifact.json');
      const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
      if (existsSync(manifestPath)) {
        if (readFileSync(manifestPath, 'utf8') !== serialized) {
          throw new Error(`paper trajectory artifact ${artifact.run.runId} is immutable`);
        }
        return cloneArtifact(artifact);
      }
      mkdirSync(artifactDir, { recursive: true });
      writeAtomically(join(artifactDir, artifact.report.filename), artifact.report.markdown);
      writeAtomically(manifestPath, serialized);
      return cloneArtifact(artifact);
    });
  }

  get(runId: string): Promise<PaperAgentTrajectoryArtifact | undefined> {
    return Promise.resolve().then(() => {
      assertNonEmpty(runId, 'runId');
      const artifactDir = this.resolveArtifactDir(runId);
      const manifestPath = join(artifactDir, 'artifact.json');
      if (!existsSync(manifestPath)) {
        return undefined;
      }
      const artifact = JSON.parse(
        readFileSync(manifestPath, 'utf8'),
      ) as PaperAgentTrajectoryArtifact;
      assertValidArtifact(artifact);
      if (
        readFileSync(join(artifactDir, artifact.report.filename), 'utf8') !==
        artifact.report.markdown
      ) {
        throw new Error(`paper trajectory artifact ${runId} has inconsistent report`);
      }
      return cloneArtifact(artifact);
    });
  }

  private resolveArtifactDir(runId: string): string {
    return join(this.rootDir, encodeURIComponent(runId));
  }
}

function createTrajectoryRow(input: {
  readonly agentId: string;
  readonly initial: PaperAgentTrajectorySnapshot;
  readonly final: PaperAgentTrajectorySnapshot;
  readonly guidance: {
    readonly early: readonly PaperAgentGuidanceObservation[];
    readonly later: readonly PaperAgentGuidanceObservation[];
  };
  readonly investments: readonly PaperAgentEducationInvestmentObservation[];
  readonly occupationTransitions: readonly PaperAgentOccupationTransitionObservation[];
  readonly residentialTransitions: readonly PaperAgentResidentialTransitionObservation[];
  readonly highStatusMinimumOccupationTier: number;
}): PaperAgentTrajectoryRow {
  assertEducationEvidenceChain(input.initial, input.final, input.investments);
  assertOccupationEvidenceChain(input.initial, input.final, input.occupationTransitions);
  assertResidentialEvidenceChain(input.initial, input.final, input.residentialTransitions);
  const firstEarlyGuidanceAt = input.guidance.early[0]?.issuedAt;
  return {
    agentId: input.agentId,
    guidedEarly: input.guidance.early.length > 0,
    earlyEducationGuidanceTraceIds: input.guidance.early.map((item) => item.traceId),
    earlyEducationObjectiveIds: input.guidance.early.map((item) => item.objectiveId),
    laterEducationGuidanceCount: input.guidance.later.length,
    ...(firstEarlyGuidanceAt === undefined ? {} : { firstEarlyGuidanceAt }),
    initial: cloneSnapshot(input.initial),
    final: cloneSnapshot(input.final),
    education: {
      investmentCount: input.investments.length,
      investmentCountAfterEarlyGuidance:
        firstEarlyGuidanceAt === undefined
          ? 0
          : input.investments.filter((item) => item.occurredAt >= firstEarlyGuidanceAt).length,
      totalDurationSeconds: sum(input.investments.map((item) => item.durationSeconds)),
      totalCurrencyCost: sum(input.investments.map((item) => item.currencyCost)),
      scoreDelta: input.final.educationScore - input.initial.educationScore,
      sourceEventIds: input.investments.flatMap((item) => item.eventIds),
    },
    mobility: {
      upwardOccupationMobility:
        input.final.occupationTier > input.initial.occupationTier,
      highStatusOccupation:
        input.final.occupationTier >= input.highStatusMinimumOccupationTier,
      occupationTransitionCount: input.occupationTransitions.length,
      occupationTransitionEventIds: input.occupationTransitions.map((item) => item.eventId),
      residentialTierDelta:
        input.final.residentialTier - input.initial.residentialTier,
      residentialTransitionCount: input.residentialTransitions.length,
      residentialTransitionEventIds: input.residentialTransitions.map((item) => item.eventId),
    },
    wealth: {
      initialNetWorth: input.initial.netWorth,
      finalNetWorth: input.final.netWorth,
      netWorthDelta: input.final.netWorth - input.initial.netWorth,
    },
  };
}

function assertEducationEvidenceChain(
  initial: PaperAgentTrajectorySnapshot,
  final: PaperAgentTrajectorySnapshot,
  investments: readonly PaperAgentEducationInvestmentObservation[],
): void {
  let educationScore = initial.educationScore;
  for (const investment of investments) {
    if (investment.previousEducationScore !== educationScore) {
      throw new Error(
        `agent ${initial.agentId} education investment chain does not match the previous score`,
      );
    }
    educationScore = investment.nextEducationScore;
  }
  if (educationScore !== final.educationScore) {
    throw new Error(
      `agent ${initial.agentId} education investment chain does not reach the final score`,
    );
  }
}

function assertOccupationEvidenceChain(
  initial: PaperAgentTrajectorySnapshot,
  final: PaperAgentTrajectorySnapshot,
  transitions: readonly PaperAgentOccupationTransitionObservation[],
): void {
  let occupationId = initial.occupationId;
  let occupationTier = initial.occupationTier;
  for (const transition of transitions) {
    if (
      transition.previousOccupationId !== occupationId ||
      transition.previousOccupationTier !== occupationTier
    ) {
      throw new Error(
        `agent ${initial.agentId} occupation transition chain does not match the previous occupation`,
      );
    }
    occupationId = transition.nextOccupationId;
    occupationTier = transition.nextOccupationTier;
  }
  if (occupationId !== final.occupationId || occupationTier !== final.occupationTier) {
    throw new Error(
      `agent ${initial.agentId} occupation transition chain does not reach the final occupation`,
    );
  }
}

function assertResidentialEvidenceChain(
  initial: PaperAgentTrajectorySnapshot,
  final: PaperAgentTrajectorySnapshot,
  transitions: readonly PaperAgentResidentialTransitionObservation[],
): void {
  let residentialTier = initial.residentialTier;
  for (const transition of transitions) {
    if (transition.previousResidentialTier !== residentialTier) {
      throw new Error(
        `agent ${initial.agentId} residential transition chain does not match the previous tier`,
      );
    }
    residentialTier = transition.nextResidentialTier;
  }
  if (residentialTier !== final.residentialTier) {
    throw new Error(
      `agent ${initial.agentId} residential transition chain does not reach the final tier`,
    );
  }
}

function createCohortSummary(
  cohort: PaperAgentTrajectoryCohortSummary['cohort'],
  rows: readonly PaperAgentTrajectoryRow[],
): PaperAgentTrajectoryCohortSummary {
  const investorCount = rows.filter((row) => row.education.investmentCount > 0).length;
  const upwardCount = rows.filter((row) => row.mobility.upwardOccupationMobility).length;
  const highStatusCount = rows.filter((row) => row.mobility.highStatusOccupation).length;
  return {
    cohort,
    agentCount: rows.length,
    medianInitialEducationScore: median(rows.map((row) => row.initial.educationScore)),
    medianInitialNetWorth: median(rows.map((row) => row.initial.netWorth)),
    medianInitialResidentialTier: median(rows.map((row) => row.initial.residentialTier)),
    educationInvestorCount: investorCount,
    educationInvestmentRate: investorCount / rows.length,
    medianEducationScoreDelta: median(rows.map((row) => row.education.scoreDelta)),
    medianFinalEducationScore: median(rows.map((row) => row.final.educationScore)),
    medianFinalNetWorth: median(rows.map((row) => row.final.netWorth)),
    medianNetWorthDelta: median(rows.map((row) => row.wealth.netWorthDelta)),
    upwardOccupationMobilityCount: upwardCount,
    upwardOccupationMobilityRate: upwardCount / rows.length,
    highStatusOccupationCount: highStatusCount,
    highStatusOccupationRate: highStatusCount / rows.length,
    medianResidentialTierDelta: median(
      rows.map((row) => row.mobility.residentialTierDelta),
    ),
  };
}

function groupGuidance(input: {
  readonly observations: readonly PaperAgentGuidanceObservation[];
  readonly run: PaperAgentTrajectoryRun;
  readonly expectedAgentIds: ReadonlySet<string>;
  readonly earlyWindowEndedAt: number;
}): ReadonlyMap<
  string,
  {
    readonly early: readonly PaperAgentGuidanceObservation[];
    readonly later: readonly PaperAgentGuidanceObservation[];
  }
> {
  const grouped = new Map<
    string,
    { early: PaperAgentGuidanceObservation[]; later: PaperAgentGuidanceObservation[] }
  >();
  const traceIds = new Set<string>();
  for (const observation of input.observations) {
    validateGuidance(observation, input.run, input.expectedAgentIds);
    if (traceIds.has(observation.traceId)) {
      throw new Error(`duplicate guidance traceId ${observation.traceId}`);
    }
    traceIds.add(observation.traceId);
    if (!isEducationGuidance(observation)) {
      continue;
    }
    const group = grouped.get(observation.agentId) ?? { early: [], later: [] };
    if (observation.issuedAt < input.earlyWindowEndedAt) {
      group.early.push(cloneGuidance(observation));
    } else {
      group.later.push(cloneGuidance(observation));
    }
    grouped.set(observation.agentId, group);
  }
  for (const group of grouped.values()) {
    group.early.sort(compareGuidance);
    group.later.sort(compareGuidance);
  }
  return grouped;
}

function groupEducationInvestments(input: {
  readonly observations: readonly PaperAgentEducationInvestmentObservation[];
  readonly run: PaperAgentTrajectoryRun;
  readonly expectedAgentIds: ReadonlySet<string>;
}): ReadonlyMap<string, readonly PaperAgentEducationInvestmentObservation[]> {
  const grouped = new Map<string, PaperAgentEducationInvestmentObservation[]>();
  const commandIds = new Set<string>();
  const eventIds = new Set<string>();
  for (const observation of input.observations) {
    validateEducationInvestment(observation, input.run, input.expectedAgentIds);
    if (commandIds.has(observation.commandId)) {
      throw new Error(`duplicate education investment commandId ${observation.commandId}`);
    }
    commandIds.add(observation.commandId);
    for (const eventId of observation.eventIds) {
      if (eventIds.has(eventId)) {
        throw new Error(`duplicate education investment eventId ${eventId}`);
      }
      eventIds.add(eventId);
    }
    const values = grouped.get(observation.agentId) ?? [];
    values.push(cloneInvestment(observation));
    grouped.set(observation.agentId, values);
  }
  for (const values of grouped.values()) {
    values.sort(compareOccurredAtThenId((value) => value.commandId));
  }
  return grouped;
}

function groupOccupationTransitions(input: {
  readonly observations: readonly PaperAgentOccupationTransitionObservation[];
  readonly run: PaperAgentTrajectoryRun;
  readonly expectedAgentIds: ReadonlySet<string>;
}): ReadonlyMap<string, readonly PaperAgentOccupationTransitionObservation[]> {
  const grouped = new Map<string, PaperAgentOccupationTransitionObservation[]>();
  const eventIds = new Set<string>();
  for (const observation of input.observations) {
    validateOccupationTransition(observation, input.run, input.expectedAgentIds);
    if (eventIds.has(observation.eventId)) {
      throw new Error(`duplicate occupation transition eventId ${observation.eventId}`);
    }
    eventIds.add(observation.eventId);
    const values = grouped.get(observation.agentId) ?? [];
    values.push({ ...observation });
    grouped.set(observation.agentId, values);
  }
  for (const values of grouped.values()) {
    values.sort(compareOccurredAtThenId((value) => value.eventId));
  }
  return grouped;
}

function groupResidentialTransitions(input: {
  readonly observations: readonly PaperAgentResidentialTransitionObservation[];
  readonly run: PaperAgentTrajectoryRun;
  readonly expectedAgentIds: ReadonlySet<string>;
}): ReadonlyMap<string, readonly PaperAgentResidentialTransitionObservation[]> {
  const grouped = new Map<string, PaperAgentResidentialTransitionObservation[]>();
  const eventIds = new Set<string>();
  for (const observation of input.observations) {
    validateResidentialTransition(observation, input.run, input.expectedAgentIds);
    if (eventIds.has(observation.eventId)) {
      throw new Error(`duplicate residential transition eventId ${observation.eventId}`);
    }
    eventIds.add(observation.eventId);
    const values = grouped.get(observation.agentId) ?? [];
    values.push({ ...observation });
    grouped.set(observation.agentId, values);
  }
  for (const values of grouped.values()) {
    values.sort(compareOccurredAtThenId((value) => value.eventId));
  }
  return grouped;
}

function createSnapshotMap(
  observations: readonly PaperAgentTrajectorySnapshot[],
  expectedObservedAt: number,
  name: string,
): ReadonlyMap<string, PaperAgentTrajectorySnapshot> {
  if (observations.length === 0) {
    throw new Error(`${name} requires at least one agent`);
  }
  const byAgent = new Map<string, PaperAgentTrajectorySnapshot>();
  for (const observation of observations) {
    validateSnapshot(observation, expectedObservedAt, name);
    if (byAgent.has(observation.agentId)) {
      throw new Error(`${name} contains duplicate agentId ${observation.agentId}`);
    }
    byAgent.set(observation.agentId, cloneSnapshot(observation));
  }
  return byAgent;
}

function assertMatchingAgentSets(
  initial: ReadonlyMap<string, PaperAgentTrajectorySnapshot>,
  final: ReadonlyMap<string, PaperAgentTrajectorySnapshot>,
): void {
  const initialIds = [...initial.keys()].sort();
  const finalIds = [...final.keys()].sort();
  if (JSON.stringify(initialIds) !== JSON.stringify(finalIds)) {
    throw new Error('initialSnapshot and finalSnapshot must contain the same agent IDs');
  }
}

function isEducationGuidance(observation: PaperAgentGuidanceObservation): boolean {
  if (observation.source !== 'human') {
    return false;
  }
  return (
    observation.affinityTags.some((tag) => EDUCATION_GUIDANCE_TAGS.has(tag.toLowerCase())) ||
    EDUCATION_GUIDANCE_TEXT_PATTERN.test(observation.statement)
  );
}

function renderPaperAgentTrajectoryMarkdown(
  artifact: Omit<PaperAgentTrajectoryArtifact, 'report'>,
): string {
  const guided = artifact.cohorts.earlyEducationGuided;
  const unguided = artifact.cohorts.notEarlyEducationGuided;
  const lines = [
    '# Agent trajectory analysis',
    '',
    `- Policy: \`${artifact.schemaVersion}\``,
    `- Run: \`${artifact.run.runId}\``,
    `- Run manifest: \`${artifact.run.runManifestId}\``,
    `- Source revision: \`${artifact.run.sourceRevision.commit}\` (dirty=${String(artifact.run.sourceRevision.dirty)})`,
    `- Seed: \`${artifact.run.seed}\``,
    `- Window: ${artifact.run.experimentStartedAt} to ${artifact.run.experimentEndedAt}`,
    `- Early guidance cutoff (exclusive): ${artifact.earlyWindow.endedAtExclusive}`,
    '',
    '## Interpretation boundary',
    '',
    '**Observational correlation only. These contrasts are not causal treatment effects.**',
    '',
    ...artifact.limitations.map((limitation) => `- ${limitation}`),
    '',
    '## Cohort summary',
    '',
    '| Cohort | Agents | Initial education median | Initial net worth median | Education investor rate | Education delta median | Final net worth median | Upward mobility rate | High-status rate |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    renderCohortRow(guided),
    renderCohortRow(unguided),
    '',
    '## Guided-minus-unguided descriptive differences',
    '',
    `- Education investment rate: ${formatNumber(artifact.descriptiveAssociations.educationInvestmentRateDifference)}`,
    `- Median education-score change: ${formatNumber(artifact.descriptiveAssociations.medianEducationScoreDeltaDifference)}`,
    `- Median final net worth: ${formatNumber(artifact.descriptiveAssociations.medianFinalNetWorthDifference)}`,
    `- Median net-worth change: ${formatNumber(artifact.descriptiveAssociations.medianNetWorthDeltaDifference)}`,
    `- Upward occupation mobility rate: ${formatNumber(artifact.descriptiveAssociations.upwardOccupationMobilityRateDifference)}`,
    `- High-status occupation rate: ${formatNumber(artifact.descriptiveAssociations.highStatusOccupationRateDifference)}`,
    '',
    '## Agent evidence',
    '',
    '| Agent | Early guided | Guidance traces | Education investments | Education delta | Initial occupation tier | Final occupation tier | Residential delta | Final net worth |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...artifact.trajectories.map(
      (row) =>
        `| ${escapeMarkdown(row.agentId)} | ${row.guidedEarly ? 'yes' : 'no'} | ${escapeMarkdown(row.earlyEducationGuidanceTraceIds.join(', '))} | ${row.education.investmentCount} | ${formatNumber(row.education.scoreDelta)} | ${row.initial.occupationTier} | ${row.final.occupationTier} | ${formatNumber(row.mobility.residentialTierDelta)} | ${formatNumber(row.final.netWorth)} |`,
    ),
    '',
  ];
  return `${lines.join('\n')}\n`;
}

function renderCohortRow(cohort: PaperAgentTrajectoryCohortSummary): string {
  return `| ${cohort.cohort} | ${cohort.agentCount} | ${formatNumber(cohort.medianInitialEducationScore)} | ${formatNumber(cohort.medianInitialNetWorth)} | ${formatNumber(cohort.educationInvestmentRate)} | ${formatNumber(cohort.medianEducationScoreDelta)} | ${formatNumber(cohort.medianFinalNetWorth)} | ${formatNumber(cohort.upwardOccupationMobilityRate)} | ${formatNumber(cohort.highStatusOccupationRate)} |`;
}

function validateRun(run: PaperAgentTrajectoryRun): void {
  assertNonEmpty(run.runId, 'run.runId');
  assertNonEmpty(run.simulationId, 'run.simulationId');
  assertNonEmpty(run.runManifestId, 'run.runManifestId');
  assertNonEmpty(run.sourceRevision.commit, 'run.sourceRevision.commit');
  assertNonEmpty(run.seed, 'run.seed');
  assertFinite(run.experimentStartedAt, 'run.experimentStartedAt');
  assertFinite(run.experimentEndedAt, 'run.experimentEndedAt');
  assertFinite(run.generatedAt, 'run.generatedAt');
  if (run.experimentEndedAt <= run.experimentStartedAt) {
    throw new Error('run experimentEndedAt must be greater than experimentStartedAt');
  }
  if (run.generatedAt < run.experimentEndedAt) {
    throw new Error('run generatedAt must be at or after experimentEndedAt');
  }
}

function validateSnapshot(
  snapshot: PaperAgentTrajectorySnapshot,
  expectedObservedAt: number,
  name: string,
): void {
  assertNonEmpty(snapshot.agentId, `${name} agentId`);
  assertFinite(snapshot.observedAt, `${name} observedAt`);
  if (snapshot.observedAt !== expectedObservedAt) {
    throw new Error(`${name} observedAt must match the experiment boundary`);
  }
  assertFinite(snapshot.educationScore, `${name} educationScore`);
  assertNonNegative(snapshot.educationScore, `${name} educationScore`);
  assertFinite(snapshot.netWorth, `${name} netWorth`);
  assertNonNegative(snapshot.netWorth, `${name} netWorth`);
  assertPositiveInteger(snapshot.residentialTier, `${name} residentialTier`);
  assertOccupationTier(snapshot.occupationTier, `${name} occupationTier`, true);
  if (snapshot.occupationId === undefined && snapshot.occupationTier !== 0) {
    throw new Error(`${name} unemployed agents must use occupationTier 0`);
  }
  if (snapshot.occupationId !== undefined) {
    assertNonEmpty(snapshot.occupationId, `${name} occupationId`);
    if (snapshot.occupationTier === 0) {
      throw new Error(`${name} employed agents must use a positive occupationTier`);
    }
  }
}

function validateGuidance(
  observation: PaperAgentGuidanceObservation,
  run: PaperAgentTrajectoryRun,
  expectedAgentIds: ReadonlySet<string>,
): void {
  assertNonEmpty(observation.traceId, 'guidance traceId');
  assertNonEmpty(observation.commandId, 'guidance commandId');
  assertNonEmpty(observation.objectiveId, 'guidance objectiveId');
  assertKnownAgent(observation.agentId, expectedAgentIds, 'guidance');
  assertNonEmpty(observation.source, 'guidance source');
  assertNonEmpty(observation.statement, 'guidance statement');
  assertWithinRun(observation.issuedAt, run, 'guidance issuedAt');
  if (observation.planId !== undefined) {
    assertNonEmpty(observation.planId, 'guidance planId');
  }
  for (const tag of observation.affinityTags) {
    assertNonEmpty(tag, 'guidance affinityTag');
  }
}

function validateEducationInvestment(
  observation: PaperAgentEducationInvestmentObservation,
  run: PaperAgentTrajectoryRun,
  expectedAgentIds: ReadonlySet<string>,
): void {
  assertKnownAgent(observation.agentId, expectedAgentIds, 'educationInvestment');
  assertNonEmpty(observation.commandId, 'educationInvestment commandId');
  if (observation.eventIds.length < 2) {
    throw new Error('educationInvestment requires payment and education-change event IDs');
  }
  for (const eventId of observation.eventIds) {
    assertNonEmpty(eventId, 'educationInvestment eventId');
  }
  assertWithinRun(observation.occurredAt, run, 'educationInvestment occurredAt');
  assertPositiveFinite(observation.durationSeconds, 'educationInvestment durationSeconds');
  assertNonNegative(observation.currencyCost, 'educationInvestment currencyCost');
  assertFinite(observation.previousEducationScore, 'educationInvestment previousEducationScore');
  assertFinite(observation.nextEducationScore, 'educationInvestment nextEducationScore');
  if (observation.nextEducationScore <= observation.previousEducationScore) {
    throw new Error('educationInvestment must increase education score');
  }
}

function validateOccupationTransition(
  observation: PaperAgentOccupationTransitionObservation,
  run: PaperAgentTrajectoryRun,
  expectedAgentIds: ReadonlySet<string>,
): void {
  assertKnownAgent(observation.agentId, expectedAgentIds, 'occupationTransition');
  assertNonEmpty(observation.eventId, 'occupationTransition eventId');
  assertWithinRun(observation.occurredAt, run, 'occupationTransition occurredAt');
  if (observation.commandId !== undefined) {
    assertNonEmpty(observation.commandId, 'occupationTransition commandId');
  }
  if (observation.previousOccupationId !== undefined) {
    assertNonEmpty(observation.previousOccupationId, 'occupationTransition previousOccupationId');
  }
  assertNonEmpty(observation.nextOccupationId, 'occupationTransition nextOccupationId');
  assertOccupationTier(
    observation.previousOccupationTier,
    'occupationTransition previousOccupationTier',
    true,
  );
  assertOccupationTier(
    observation.nextOccupationTier,
    'occupationTransition nextOccupationTier',
    false,
  );
}

function validateResidentialTransition(
  observation: PaperAgentResidentialTransitionObservation,
  run: PaperAgentTrajectoryRun,
  expectedAgentIds: ReadonlySet<string>,
): void {
  assertKnownAgent(observation.agentId, expectedAgentIds, 'residentialTransition');
  assertNonEmpty(observation.eventId, 'residentialTransition eventId');
  assertWithinRun(observation.occurredAt, run, 'residentialTransition occurredAt');
  if (observation.commandId !== undefined) {
    assertNonEmpty(observation.commandId, 'residentialTransition commandId');
  }
  assertPositiveInteger(
    observation.previousResidentialTier,
    'residentialTransition previousResidentialTier',
  );
  assertPositiveInteger(
    observation.nextResidentialTier,
    'residentialTransition nextResidentialTier',
  );
  if (observation.nextResidentialTier <= observation.previousResidentialTier) {
    throw new Error('residentialTransition must increase residential tier');
  }
}

function assertValidArtifact(artifact: PaperAgentTrajectoryArtifact): void {
  if (artifact.schemaVersion !== PAPER_AGENT_TRAJECTORY_POLICY_VERSION) {
    throw new Error('paper trajectory artifact has unsupported schemaVersion');
  }
  validateRun(artifact.run);
  if (artifact.policy.causalClaimPermitted !== false) {
    throw new Error('paper trajectory artifact must prohibit causal claims');
  }
  if (artifact.descriptiveAssociations.interpretation !== 'observational-correlation-only') {
    throw new Error('paper trajectory artifact must preserve observational interpretation');
  }
  if (artifact.descriptiveAssociations.causalClaimPermitted !== false) {
    throw new Error('paper trajectory artifact must prohibit causal interpretation');
  }
  if (artifact.trajectories.length === 0) {
    throw new Error('paper trajectory artifact requires trajectories');
  }
  if (artifact.report.filename !== 'agent-trajectory-analysis.md') {
    throw new Error('paper trajectory artifact report filename is invalid');
  }
  assertNonEmpty(artifact.report.markdown, 'artifact report markdown');
}

function assertWithinRun(value: number, run: PaperAgentTrajectoryRun, name: string): void {
  assertFinite(value, name);
  if (value < run.experimentStartedAt || value > run.experimentEndedAt) {
    throw new Error(`${name} must be inside the experiment window`);
  }
}

function assertKnownAgent(
  agentId: string,
  expectedAgentIds: ReadonlySet<string>,
  name: string,
): void {
  assertNonEmpty(agentId, `${name} agentId`);
  if (!expectedAgentIds.has(agentId)) {
    throw new Error(`${name} references unknown agent ${agentId}`);
  }
}

function assertOccupationTier(value: number, name: string, allowUnemployed: boolean): void {
  if (!Number.isInteger(value) || value < (allowUnemployed ? 0 : 1) || value > 6) {
    throw new Error(`${name} must be an integer from ${allowUnemployed ? 0 : 1} to 6`);
  }
}

function assertFraction(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0 || value >= 1) {
    throw new Error(`${name} must be greater than 0 and less than 1`);
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be positive and finite`);
  }
}

function assertNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be non-negative and finite`);
  }
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}

function median(values: readonly number[]): number {
  if (values.length === 0) {
    throw new Error('median requires at least one value');
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function compareGuidance(
  left: PaperAgentGuidanceObservation,
  right: PaperAgentGuidanceObservation,
): number {
  if (left.issuedAt !== right.issuedAt) {
    return left.issuedAt - right.issuedAt;
  }
  return left.traceId.localeCompare(right.traceId);
}

function compareOccurredAtThenId<TValue extends { readonly occurredAt: number }>(
  getId: (value: TValue) => string,
): (left: TValue, right: TValue) => number {
  return (left, right) => {
    if (left.occurredAt !== right.occurredAt) {
      return left.occurredAt - right.occurredAt;
    }
    return getId(left).localeCompare(getId(right));
  };
}

function cloneRun(run: PaperAgentTrajectoryRun): PaperAgentTrajectoryRun {
  return { ...run, sourceRevision: cloneSourceRevision(run.sourceRevision) };
}

function cloneSnapshot(snapshot: PaperAgentTrajectorySnapshot): PaperAgentTrajectorySnapshot {
  return { ...snapshot };
}

function cloneGuidance(
  observation: PaperAgentGuidanceObservation,
): PaperAgentGuidanceObservation {
  return { ...observation, affinityTags: [...observation.affinityTags] };
}

function cloneInvestment(
  observation: PaperAgentEducationInvestmentObservation,
): PaperAgentEducationInvestmentObservation {
  return { ...observation, eventIds: [...observation.eventIds] };
}

function cloneArtifact(artifact: PaperAgentTrajectoryArtifact): PaperAgentTrajectoryArtifact {
  return JSON.parse(JSON.stringify(artifact)) as PaperAgentTrajectoryArtifact;
}

function writeAtomically(path: string, content: string): void {
  const temporaryPath = `${path}.tmp-${process.pid}`;
  writeFileSync(temporaryPath, content, 'utf8');
  renameSync(temporaryPath, path);
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(6).replace(/0+$/u, '').replace(/\.$/u, '');
}

function escapeMarkdown(value: string): string {
  return value.replace(/\|/gu, '\\|').replace(/\r?\n/gu, ' ');
}
