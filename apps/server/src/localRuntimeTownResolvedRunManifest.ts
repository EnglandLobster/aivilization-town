import {
  assertReproducibleSourceRevision,
  createFileEventStoreRuntimeIndexPolicyManifest,
} from '@aivilization/sim-core';
import {
  LOCAL_SIMULATION_RUNTIME_RESOLVED_RUN_MANIFEST_SCHEMA_VERSION,
  SCENARIO_TIME_SCALE_POLICY_VERSION,
  createAivilizationWorldPolicyManifest,
  createCanonicalAmbientObservationMemoryPolicyManifest,
  createCanonicalMemoryConsolidationPolicyManifest,
  createLocalProjectionSnapshotRetentionPolicy,
  createLocalSimulationRuntimeRunSessionLedgerPolicyManifest,
  createPaperMarketDataPipelineManifest,
  createPlanningSessionPublicationPolicyManifest,
  createLocalSimulationRuntimeJsonObject,
  createLocalSimulationRuntimeResolvedRunManifest,
  type LocalSimulationRuntimeResolvedRunManifest,
} from '@aivilization/worker';
import {
  createPaperPlannerAblationPolicyManifest,
  createPlanningStoragePolicyManifest,
} from '@aivilization/agent-runtime';
import {
  createAgentIntentionLedgerPolicyManifest,
  createFileShortTermMemoryStoragePolicyManifest,
} from '@aivilization/memory';
import {
  LOCAL_RUNTIME_TOWN_LLM_POLICY_ID,
  createLocalRuntimeTownLlmManifest,
} from './localRuntimeTownLlm';
import {
  createAgentCycleTraceStoragePolicyManifest,
  createBoundedTraceLedgerPolicyManifest,
  createMarketStylizedFactsPolicyManifest,
  createPaperAgentTrajectoryPolicyManifest,
  createPaperMatureMarketDatasetPolicyManifest,
  createPaperMarketAnalysisPolicyManifest,
  createPaperMarketFigurePolicyManifest,
  createPaperPlannerAblationExperimentPolicyManifest,
  createPaperStratificationPolicyManifest,
  createRuntimeResourceEnvelopePolicyManifest,
  createRuntimeSoakEvidencePolicyManifest,
  getPaperPlannerAblationTaskDefinition,
} from '@aivilization/observability';
import {
  createLocalRuntimeTownDaemonScenarioProfile,
  createLocalRuntimeTownEducationSystemPolicyOverride,
} from './localRuntimeTownScenarioProfile';
import type { LocalRuntimeTownCliConfig } from './localRuntimeTownCli';
import { createLocalRuntimeTownProductionSloPolicy } from './localRuntimeTownProductionSlo';
import { createLocalRuntimeTownDataCompatibilityPolicy } from './localRuntimeTownDataCompatibility';
import { createLocalRuntimeTownParticipantAccessManifest } from './localRuntimeTownParticipantAccess';

export function createCanonicalLocalRuntimeTownResolvedRunManifest(
  config: LocalRuntimeTownCliConfig,
): LocalSimulationRuntimeResolvedRunManifest {
  assertReproducibleSourceRevision(config.sourceRevision, 'config.sourceRevision');
  const profile = createLocalRuntimeTownDaemonScenarioProfile(config.profileId);
  const educationSystemOverride = createLocalRuntimeTownEducationSystemPolicyOverride(
    config.profileId,
  );

  return createLocalSimulationRuntimeResolvedRunManifest({
    schemaVersion: LOCAL_SIMULATION_RUNTIME_RESOLVED_RUN_MANIFEST_SCHEMA_VERSION,
    composition: createLocalSimulationRuntimeJsonObject(
      {
        id: 'aivilization-town',
        version: config.compositionVersion,
      },
      'composition',
    ),
    sourceRevision: { ...config.sourceRevision },
    seed: config.seed,
    scenario: createLocalSimulationRuntimeJsonObject(
      {
        profileId: profile.profileId,
        name: profile.name,
        description: profile.description,
        agentCount: profile.agentCount,
        headless: profile.headless,
        manifest: profile.manifest,
        scenarioPresets: profile.scenarioPresets,
      },
      'scenario',
    ),
    policies: createLocalSimulationRuntimeJsonObject(
      createAivilizationWorldPolicyManifest({
        ...(config.participantAccess?.mode !== 'authenticated'
          ? {}
          : {
              agentRegistration: {
                maxAgentsPerCreator: config.participantAccess.maxAgentsPerParticipant,
                creatorIdentityRule: 'authenticated-principal-subject',
              },
            }),
        ...(config.townWeatherEnabled ? { townWeather: true } : {}),
        ...(config.townConditionsEnabled ? { townConditions: true } : {}),
        ...(config.townBulletinEnabled ? { townBulletin: true } : {}),
        ...(config.socialMattersEnabled ? { socialMatters: true } : {}),
        ...(config.townConflictEnabled ? { townConflict: true } : {}),
        ...(config.townWellbeingEnabled ? { townWellbeing: true } : {}),
        ...(config.townCalendarEnabled ? { townCalendar: true } : {}),
        ...(config.townLifecycleEnabled ? { townLifecycle: true } : {}),
        ...(config.townDiscourseEnabled ? { townDiscourse: true } : {}),
        // The paper-ablation cohort runs with the education system disabled;
        // record that override so the manifest provenance matches the runtime.
        ...(educationSystemOverride === undefined
          ? {}
          : { educationSystem: educationSystemOverride }),
      }),
      'policies',
    ),
    cognition: createLocalSimulationRuntimeJsonObject(
      config.llm === undefined
        ? {
            mode: 'deterministic',
            policyId: LOCAL_RUNTIME_TOWN_LLM_POLICY_ID,
            reason: 'explicit deterministic development/fallback mode',
            planner: createPaperPlannerAblationPolicyManifest(config.plannerVariant),
            planningStorage: createPlanningStoragePolicyManifest(),
            planningSessionPublication: createPlanningSessionPublicationPolicyManifest(),
          }
        : {
            ...createLocalRuntimeTownLlmManifest(config.llm),
            planner: createPaperPlannerAblationPolicyManifest(config.plannerVariant),
            planningStorage: createPlanningStoragePolicyManifest(),
            planningSessionPublication: createPlanningSessionPublicationPolicyManifest(),
          },
      'cognition',
    ),
    memory: createLocalSimulationRuntimeJsonObject(
      {
        consolidation: createCanonicalMemoryConsolidationPolicyManifest(),
        shortTermStorage: createFileShortTermMemoryStoragePolicyManifest(),
        agentIntentions: createAgentIntentionLedgerPolicyManifest(),
      },
      'memory',
    ),
    observations: createLocalSimulationRuntimeJsonObject(
      {
        ambientObservationMemory: createCanonicalAmbientObservationMemoryPolicyManifest(),
        agentCycleTraces: createAgentCycleTraceStoragePolicyManifest(),
        planningLifecycleTraces: createBoundedTraceLedgerPolicyManifest(),
        eventStoreRuntimeIndex: createFileEventStoreRuntimeIndexPolicyManifest(),
        marketTradeObservations: {
          repositoryScope: 'per-partition-file-repository',
          ...createPaperMarketDataPipelineManifest(),
        },
        validationReports: { storage: 'per-partition-file-repository' },
      },
      'observations',
    ),
    validation: createLocalSimulationRuntimeJsonObject(
      {
        mode: 'artifact-backed-on-demand',
        automaticLifecycleSchedule: false,
        requiredEvidence: [
          'trade-observations',
          'mature-market-dataset-artifact',
          'paper-market-analysis-artifact',
          'planner-default-and-ablation-runs',
          'longitudinal-agent-trajectory-artifact',
          'runtime-soak-evidence-artifact',
          'runtime-resource-envelope-assessment-artifact',
        ],
        marketStylizedFacts: createMarketStylizedFactsPolicyManifest(),
        paperMatureMarketDataset: createPaperMatureMarketDatasetPolicyManifest(),
        paperMarketAnalysis: createPaperMarketAnalysisPolicyManifest(),
        paperMarketFigures: createPaperMarketFigurePolicyManifest(),
        paperStratification: createPaperStratificationPolicyManifest(),
        paperAgentTrajectories: createPaperAgentTrajectoryPolicyManifest(),
        runtimeSoakEvidence: createRuntimeSoakEvidencePolicyManifest(),
        runtimeResourceEnvelope: createRuntimeResourceEnvelopePolicyManifest(),
        paperPlannerAblation: {
          ...createPaperPlannerAblationExperimentPolicyManifest(),
          activeTask:
            config.paperAblationTaskId === undefined
              ? null
              : getPaperPlannerAblationTaskDefinition(config.paperAblationTaskId),
        },
      },
      'validation',
    ),
    runtime: createLocalSimulationRuntimeJsonObject(
      {
        rootDir: config.rootDir,
        bind: { host: config.host, port: config.port },
        participantAccess: createLocalRuntimeTownParticipantAccessManifest(
          config.participantAccess,
        ),
        runQueue: {
          ...profile.runtimeRunQueue,
          autoStart: true,
          leaseRenewalRule: 'active-worker-renews-every-one-third-lease-duration',
          terminalTransitionFencing: 'leased-worker-id-and-attempt-number-must-match',
          workerHostConcurrency: 'single-flight-across-polling-recovery-and-manual-drain',
        },
        runSessions: createLocalSimulationRuntimeRunSessionLedgerPolicyManifest(),
        scheduler: { ...profile.runtimeScheduler, autoStart: true },
        recovery: { ...profile.runtimeRecovery, autoStart: true },
        productionSlo: createLocalRuntimeTownProductionSloPolicy({
          maxPendingJobs:
            profile.runtimeScheduler.maxPendingJobs ?? profile.runtimeRunQueue.maxJobsPerPoll ?? 1,
          workerPollIntervalMs: profile.runtimeRunQueue.pollIntervalMs ?? 1_000,
          schedulerIntervalMs: profile.runtimeScheduler.scheduleIntervalMs ?? 1_000,
          recoveryIntervalMs: profile.runtimeRecovery.recoveryIntervalMs ?? 1_000,
        }),
        dataCompatibility: createLocalRuntimeTownDataCompatibilityPolicy(),
        projectionSnapshots: createLocalProjectionSnapshotRetentionPolicy(),
        simulationClock: {
          policyVersion: SCENARIO_TIME_SCALE_POLICY_VERSION,
          timeDeltaFormula: 'scenario.clock.tickDurationMs*scenario.timeScale',
          explicitOverride: null,
        },
      },
      'runtime',
    ),
  });
}
