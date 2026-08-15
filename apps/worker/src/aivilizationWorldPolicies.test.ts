import { asAgentId, createCommandEnvelope } from '@aivilization/sim-core';
import {
  aivilizationCreditPolicyDefaults,
  aivilizationExternalTradePolicyDefaults,
  aivilizationLifestylePolicyDefaults,
  aivilizationTaxPolicyDefaults,
} from '@aivilization/content';
import {
  applyWorldEvent,
  assertTownWeatherPolicy,
  createWorldProjection,
  dispatchWorldCommand,
} from '@aivilization/world';
import {
  assertTownConditionsPolicy,
  assertValidLifecyclePolicy,
  assertValidTownCalendarPolicy,
  assertValidWellbeingPolicy,
} from '@aivilization/society';
import { describe, expect, test } from 'vitest';
import {
  createAivilizationTownCalendarPolicy,
  createAivilizationTownLifecyclePolicy,
  createAivilizationTownConditionsPolicy,
  createAivilizationTownWeatherPolicy,
  createAivilizationTownWellbeingPolicy,
  createAivilizationWorldCommandPolicies,
  createAivilizationWorldPolicyManifest,
} from './index';

describe('AIvilization default world command policies', () => {
  test('versions canonical opportunity-cost, action-allocation, and planning decisions', () => {
    expect(createAivilizationWorldPolicyManifest()).toMatchObject({
      policyVersions: {
        educationAccumulation: 'education-accumulation-v2',
        educationOpportunityCost: 'education-opportunity-cost-v2',
        agentActivityTimeAllocation: 'exclusive-agent-activity-time-v2',
        globalSynthesis: 'global-action-synthesis-v1',
        autonomousObjectiveSelection: 'autonomous-objective-selection-v3',
        strategicPlanning: 'deterministic-strategic-planning-v3',
        strategicPlanRenewal: 'strategic-plan-renewal-v3',
        memoryConsolidation: 'dual-process-memory-consolidation-v4',
        worldProjectionMemoryRetention: 'world-projection-memory-retention-v1',
        townSpatialGraph: 'town-spatial-graph-v1',
      },
      parameters: {
        townSpatialGraph: {
          policyVersion: 'town-spatial-graph-v1',
          routing: 'minimum-base-travel-duration',
          capacitySemantics: 'destination-occupancy-reserved-at-move-commit',
        },
        agentAllocation: {
          schemaVersion: 'canonical-agent-allocation-policy-v1',
          educationOpportunityCost: {
            studyDurationSeconds: 1800,
            accumulationPolicyVersion: 'education-accumulation-v2',
            educationRatePerSecond: 1 / 60,
            workLaborSeconds: 3600,
            minimumBalanceReserve: 50,
          },
          actionSynthesis: {
            maxActions: 1,
            candidateSubtasks: { maxSubtasks: 9 },
          },
          activityTime: {
            policyVersion: 'exclusive-agent-activity-time-v2',
            tradeDurationSeconds: 300,
            lifecycleRule: 'complete-objective-and-schedule-next-action-only-after-availability',
            mode: 'exclusive-per-agent',
            settlementTiming: 'effects-at-commit',
          },
        },
        planning: {
          autonomousObjectiveSelection: {
            policyVersion: 'autonomous-objective-selection-v3',
            source: 'repository-design',
            lifeCourse: {
              policyVersion: 'autonomous-life-course-v2',
              occupationSelection: 'current-wage-times-stable-agent-preference-then-tier-then-name',
              marketBuySlippageReserveMultiplier: 1.1,
              scores: {
                occupationApplication: 82,
                residentialUpgrade: 78,
                progressionAcquisition: 76,
                educationInvestment: 72,
                employmentIncome: 68,
                progressionSupply: 64,
                inventorySale: 62,
                profitableProduction: 56,
              },
            },
          },
          globalSynthesis: {
            policyVersion: 'global-action-synthesis-v1',
            tieBreak: 'action-id-ascending',
          },
          strategicPlanning: {
            policyVersion: 'deterministic-strategic-planning-v3',
            ambiguousTokensExcludedFromResidentialInference: ['tier'],
          },
          strategicPlanRenewal: {
            policyVersion: 'strategic-plan-renewal-v3',
            marketPriceIndexRelativeShiftThreshold: 0.25,
          },
        },
        memoryConsolidation: {
          policyVersion: 'dual-process-memory-consolidation-v4',
          immediateSocialReflectionRule:
            'every-successful-social-interaction-bypasses-importance-gate',
          longTermIdentityEvidenceRule:
            'current-social-event-plus-positive-social-record-provenance-already-consolidated-in-ltm',
          recentBufferLimitPerAgent: 64,
          sparseCheckpointInterval: 1024,
          maxSparseCheckpointCount: 4096,
          durableLedgerRule:
            'append-only-jsonl-complete-ledger-with-bounded-recent-record-and-sparse-checkpoint-projections',
          ledgerLookupRule:
            'serve-complete-recent-window-else-scan-once-from-newest-checkpoint-not-after-oldest-required-append-sequence',
          cursorRule: 'advance-append-sequence-only-after-successful-consolidation',
          legacyCursorUpgradeRule:
            'replay-inclusive-boundary-timestamp-then-persist-append-sequence',
        },
        worldProjectionMemoryRetention: {
          policyVersion: 'world-projection-memory-retention-v1',
          provenance: 'repository-design',
          projectionRole: 'bounded-recent-observability-cache-not-authoritative-memory',
          recentRecordLimit: 256,
          authoritativeHistory: ['short-term-memory-ledger', 'world-event-stream'],
          cognitionReadPath: 'short-term-memory-repository',
          legacySnapshotHydration: 'retain-newest-records-to-current-limit',
        },
      },
    });
  });

  test('registers provenance and replay boundaries for every canonical parameter and version', () => {
    const manifest = createAivilizationWorldPolicyManifest();

    expect(manifest.schemaVersion).toBe('aivilization-world-policy-manifest-v2');
    expect(manifest.policyRegistry).toMatchObject({
      schemaVersion: 'canonical-policy-provenance-registry-v1',
      unregisteredParameterPaths: [],
      unregisteredPolicyVersionKeys: [],
    });
    expect(manifest.policyRegistry.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          parameterPath: 'wageRegime',
          provenance: 'paper-derived',
          policyVersion: 'wage-regime-v1',
        }),
        expect.objectContaining({
          parameterPath: 'production',
          provenance: 'repository-defined',
          policyVersion: 'production-efficiency-v2',
        }),
        expect.objectContaining({
          parameterPath: 'townSpatialGraph',
          provenance: 'repository-defined',
          policyVersion: 'town-spatial-graph-v1',
        }),
      ]),
    );
    expect(
      manifest.policyRegistry.entries.every(
        (entry) =>
          entry.source.length > 0 &&
          entry.compatibilityBoundary ===
            'value-or-semantics-change-requires-new-policy-version-and-replay-boundary',
      ),
    ).toBe(true);
  });

  test('declares the canonical credit policy in the manifest and registry', () => {
    const manifest = createAivilizationWorldPolicyManifest();
    expect(manifest.policyVersions).toMatchObject({ credit: 'credit-v1' });
    expect(manifest.parameters.credit).toEqual({ ...aivilizationCreditPolicyDefaults });
    expect(manifest.policyRegistry.unregisteredParameterPaths).toEqual([]);
    expect(manifest.policyRegistry.unregisteredPolicyVersionKeys).toEqual([]);
    expect(manifest.policyRegistry.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          parameterPath: 'credit',
          provenance: 'repository-defined',
          policyVersion: 'credit-v1',
        }),
      ]),
    );
  });

  test('declares the canonical external trade policy in the manifest and registry', () => {
    const manifest = createAivilizationWorldPolicyManifest();
    expect(manifest.policyVersions).toMatchObject({ externalTrade: 'external-trade-v1' });
    expect(manifest.parameters.externalTrade).toEqual({
      ...aivilizationExternalTradePolicyDefaults,
    });
    expect(manifest.policyRegistry.unregisteredParameterPaths).toEqual([]);
    expect(manifest.policyRegistry.unregisteredPolicyVersionKeys).toEqual([]);
    expect(manifest.policyRegistry.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          parameterPath: 'externalTrade',
          provenance: 'repository-defined',
          policyVersion: 'external-trade-v1',
        }),
      ]),
    );
  });

  test('declares the town weather policy in the manifest only when the switch is on', () => {
    const off = createAivilizationWorldPolicyManifest();
    expect(off.policyVersions).not.toHaveProperty('townWeather');
    expect(off.parameters).not.toHaveProperty('townWeather');
    expect(off.policyRegistry.unregisteredParameterPaths).toEqual([]);
    expect(off.policyRegistry.unregisteredPolicyVersionKeys).toEqual([]);

    const on = createAivilizationWorldPolicyManifest({ townWeather: true });
    expect(on.policyVersions).toMatchObject({ townWeather: 'town-weather-v1' });
    expect(on.parameters.townWeather).toMatchObject({
      policyVersion: 'town-weather-v1',
      initialWeather: 'sunny',
      transitionCadenceMs: 3_600_000,
    });
    expect(on.policyRegistry.unregisteredParameterPaths).toEqual([]);
    expect(on.policyRegistry.unregisteredPolicyVersionKeys).toEqual([]);
    expect(on.policyRegistry.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          parameterPath: 'townWeather',
          provenance: 'experimental',
          policyVersion: 'town-weather-v1',
        }),
      ]),
    );

    const policy = createAivilizationTownWeatherPolicy();
    expect(policy.policyVersion).toBe('town-weather-v1');
    expect(() => assertTownWeatherPolicy(policy)).not.toThrow();
  });

  test('declares the town conditions catalog in the manifest only when the switch is on', () => {
    const off = createAivilizationWorldPolicyManifest();
    expect(off.policyVersions).not.toHaveProperty('townConditions');
    expect(off.parameters).not.toHaveProperty('townConditions');
    expect(JSON.stringify(off)).not.toContain('town-conditions-v1');

    const on = createAivilizationWorldPolicyManifest({ townConditions: true });
    expect(on.policyVersions).toMatchObject({ townConditions: 'town-conditions-v1' });
    expect(on.parameters.townConditions).toMatchObject({
      policyVersion: 'town-conditions-v1',
      overtired: { triggerBelow: 30, severeBelow: 10, need: 'sleep' },
    });
    expect(on.policyRegistry.unregisteredParameterPaths).toEqual([]);
    expect(on.policyRegistry.unregisteredPolicyVersionKeys).toEqual([]);
    expect(on.policyRegistry.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          parameterPath: 'townConditions',
          provenance: 'experimental',
          policyVersion: 'town-conditions-v1',
        }),
      ]),
    );

    const policy = createAivilizationTownConditionsPolicy();
    expect(policy.policyVersion).toBe('town-conditions-v1');
    expect(() => assertTownConditionsPolicy(policy)).not.toThrow();

    // The opt-in catalog reaches command policies only when the switch is on.
    const projection = createWorldProjection({
      agents: [createAgent({ index: 1, educationScore: 0 })],
    });
    expect(createAivilizationWorldCommandPolicies('seed')(projection).conditions).toBeUndefined();
    expect(
      createAivilizationWorldCommandPolicies('seed', undefined, { townConditions: true })(
        projection,
      ).conditions?.policyVersion,
    ).toBe('town-conditions-v1');
  });

  test('declares the town bulletin policy in the manifest only when the switch is on', () => {
    const off = createAivilizationWorldPolicyManifest();
    expect(off.policyVersions).not.toHaveProperty('townBulletin');
    expect(JSON.stringify(off)).not.toContain('town-bulletin-v1');

    const on = createAivilizationWorldPolicyManifest({ townBulletin: true });
    expect(on.policyVersions).toMatchObject({ townBulletin: 'town-bulletin-v1' });
    expect(on.parameters.townBulletin).toMatchObject({
      policyVersion: 'town-bulletin-v1',
      highPriorityIntentionPriority: 90,
    });
    expect(on.policyRegistry.unregisteredParameterPaths).toEqual([]);
    expect(on.policyRegistry.unregisteredPolicyVersionKeys).toEqual([]);
    expect(on.policyRegistry.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          parameterPath: 'townBulletin',
          provenance: 'experimental',
          policyVersion: 'town-bulletin-v1',
        }),
      ]),
    );

    const projection = createWorldProjection({
      agents: [createAgent({ index: 1, educationScore: 0 })],
    });
    expect(createAivilizationWorldCommandPolicies('seed')(projection).bulletin).toBeUndefined();
    expect(
      createAivilizationWorldCommandPolicies('seed', undefined, { townBulletin: true })(projection)
        .bulletin?.policyVersion,
    ).toBe('town-bulletin-v1');
  });

  test('declares the social matters policy in the manifest only when the switch is on', () => {
    const off = createAivilizationWorldPolicyManifest();
    expect(off.policyVersions).not.toHaveProperty('socialMatters');
    expect(JSON.stringify(off)).not.toContain('social-matters-v1');

    const on = createAivilizationWorldPolicyManifest({ socialMatters: true });
    expect(on.policyVersions).toMatchObject({ socialMatters: 'social-matters-v1' });
    expect(on.parameters.socialMatters).toMatchObject({
      policyVersion: 'social-matters-v1',
      defaultExpiryMs: 14_400_000,
    });
    expect(on.policyRegistry.unregisteredParameterPaths).toEqual([]);
    expect(on.policyRegistry.unregisteredPolicyVersionKeys).toEqual([]);
    expect(on.policyRegistry.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          parameterPath: 'socialMatters',
          provenance: 'experimental',
          policyVersion: 'social-matters-v1',
        }),
      ]),
    );

    const projection = createWorldProjection({
      agents: [createAgent({ index: 1, educationScore: 0 })],
    });
    expect(
      createAivilizationWorldCommandPolicies('seed')(projection).socialMatters,
    ).toBeUndefined();
    expect(
      createAivilizationWorldCommandPolicies('seed', undefined, { socialMatters: true })(projection)
        .socialMatters?.policyVersion,
    ).toBe('social-matters-v1');
  });

  test('declares the town conflict policy in the manifest only when the switch is on', () => {
    const off = createAivilizationWorldPolicyManifest();
    expect(off.policyVersions).not.toHaveProperty('townConflict');
    expect(JSON.stringify(off)).not.toContain('town-conflict-v1');

    const on = createAivilizationWorldPolicyManifest({ townConflict: true });
    expect(on.policyVersions).toMatchObject({ townConflict: 'town-conflict-v1' });
    expect(on.parameters.townConflict).toMatchObject({
      policyVersion: 'town-conflict-v1',
      baseDamage: 15,
      grievanceRelationThreshold: 0,
    });
    expect(on.policyRegistry.unregisteredParameterPaths).toEqual([]);
    expect(on.policyRegistry.unregisteredPolicyVersionKeys).toEqual([]);
    expect(on.policyRegistry.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          parameterPath: 'townConflict',
          provenance: 'experimental',
          policyVersion: 'town-conflict-v1',
        }),
      ]),
    );

    const projection = createWorldProjection({
      agents: [createAgent({ index: 1, educationScore: 0 })],
    });
    expect(createAivilizationWorldCommandPolicies('seed')(projection).conflict).toBeUndefined();
    expect(
      createAivilizationWorldCommandPolicies('seed', undefined, { townConflict: true })(projection)
        .conflict?.policyVersion,
    ).toBe('town-conflict-v1');
  });

  test('declares the town wellbeing policy in the manifest only when the switch is on', () => {
    const off = createAivilizationWorldPolicyManifest();
    expect(off.policyVersions).not.toHaveProperty('townWellbeing');
    expect(off.parameters).not.toHaveProperty('townWellbeing');
    expect(JSON.stringify(off)).not.toContain('town-wellbeing-v1');

    const on = createAivilizationWorldPolicyManifest({ townWellbeing: true });
    expect(on.policyVersions).toMatchObject({ townWellbeing: 'town-wellbeing-v1' });
    expect(on.parameters.townWellbeing).toMatchObject({
      policyVersion: 'town-wellbeing-v1',
      initialValue: 50,
      baseline: 50,
      convergencePerHour: 2,
    });
    expect(on.policyRegistry.unregisteredParameterPaths).toEqual([]);
    expect(on.policyRegistry.unregisteredPolicyVersionKeys).toEqual([]);
    expect(on.policyRegistry.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          parameterPath: 'townWellbeing',
          provenance: 'experimental',
          policyVersion: 'town-wellbeing-v1',
        }),
      ]),
    );

    const policy = createAivilizationTownWellbeingPolicy();
    expect(policy.policyVersion).toBe('town-wellbeing-v1');
    expect(() => assertValidWellbeingPolicy(policy)).not.toThrow();

    // The opt-in policy reaches command policies only when the switch is on.
    const projection = createWorldProjection({
      agents: [createAgent({ index: 1, educationScore: 0 })],
    });
    expect(createAivilizationWorldCommandPolicies('seed')(projection).wellbeing).toBeUndefined();
    expect(
      createAivilizationWorldCommandPolicies('seed', undefined, { townWellbeing: true })(projection)
        .wellbeing?.policyVersion,
    ).toBe('town-wellbeing-v1');
  });

  test('declares the town calendar policy in the manifest only when the switch is on', () => {
    const off = createAivilizationWorldPolicyManifest();
    expect(off.policyVersions).not.toHaveProperty('townCalendar');
    expect(off.parameters).not.toHaveProperty('townCalendar');
    expect(JSON.stringify(off)).not.toContain('town-calendar-v1');

    const on = createAivilizationWorldPolicyManifest({ townCalendar: true });
    expect(on.policyVersions).toMatchObject({ townCalendar: 'town-calendar-v1' });
    expect(on.parameters.townCalendar).toMatchObject({
      policyVersion: 'town-calendar-v1',
      dayLengthMs: 86_400_000,
      physiologicalDecay: { energyPerHour: 6.25, satietyPerHour: 12.5 },
    });
    expect(on.policyRegistry.unregisteredParameterPaths).toEqual([]);
    expect(on.policyRegistry.unregisteredPolicyVersionKeys).toEqual([]);
    expect(on.policyRegistry.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          parameterPath: 'townCalendar',
          provenance: 'experimental',
          policyVersion: 'town-calendar-v1',
        }),
      ]),
    );

    const policy = createAivilizationTownCalendarPolicy();
    expect(policy.policyVersion).toBe('town-calendar-v1');
    expect(() => assertValidTownCalendarPolicy(policy)).not.toThrow();

    // The opt-in policy reaches command policies only when the switch is on.
    const projection = createWorldProjection({
      agents: [createAgent({ index: 1, educationScore: 0 })],
    });
    expect(createAivilizationWorldCommandPolicies('seed')(projection).calendar).toBeUndefined();
    expect(
      createAivilizationWorldCommandPolicies('seed', undefined, { townCalendar: true })(projection)
        .calendar?.policyVersion,
    ).toBe('town-calendar-v1');
  });

  test('declares the town lifecycle policy in the manifest only when the switch is on', () => {
    const off = createAivilizationWorldPolicyManifest();
    expect(off.policyVersions).not.toHaveProperty('townLifecycle');
    expect(off.parameters).not.toHaveProperty('townLifecycle');
    expect(JSON.stringify(off)).not.toContain('town-lifecycle-v1');

    const on = createAivilizationWorldPolicyManifest({ townLifecycle: true });
    expect(on.policyVersions).toMatchObject({ townLifecycle: 'town-lifecycle-v1' });
    expect(on.parameters.townLifecycle).toMatchObject({
      policyVersion: 'town-lifecycle-v1',
      dayLengthMs: 86_400_000,
      stageThresholdsDays: { teen: 15, adult: 21, elderly: 70 },
      minLifespanDays: 90,
      maxLifespanDays: 130,
      pensionPerHour: 1,
    });
    expect(on.policyRegistry.unregisteredParameterPaths).toEqual([]);
    expect(on.policyRegistry.unregisteredPolicyVersionKeys).toEqual([]);
    expect(on.policyRegistry.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          parameterPath: 'townLifecycle',
          provenance: 'experimental',
          policyVersion: 'town-lifecycle-v1',
        }),
      ]),
    );

    const policy = createAivilizationTownLifecyclePolicy();
    expect(policy.policyVersion).toBe('town-lifecycle-v1');
    expect(() => assertValidLifecyclePolicy(policy)).not.toThrow();

    // The opt-in policy reaches command policies only when the switch is on.
    const projection = createWorldProjection({
      agents: [createAgent({ index: 1, educationScore: 0 })],
    });
    expect(createAivilizationWorldCommandPolicies('seed')(projection).lifecycle).toBeUndefined();
    expect(
      createAivilizationWorldCommandPolicies('seed', undefined, { townLifecycle: true })(projection)
        .lifecycle?.policyVersion,
    ).toBe('town-lifecycle-v1');
  });

  test('declares the canonical education system policy in the manifest and registry', () => {
    const manifest = createAivilizationWorldPolicyManifest();
    expect(manifest.policyVersions).toMatchObject({ educationSystem: 'education-system-v3' });
    expect(manifest.parameters.educationSystem).toMatchObject({
      policyVersion: 'education-system-v3',
      enabled: true,
      levelScoreThresholds: [20, 70, 180, 320, 450],
      compulsoryLevels: [1, 2],
      levelTuitionPerHour: { 0: 20, 1: 20, 2: 20, 3: 25, 4: 30, 5: 40 },
      employedStudyEfficiencyRatio: 0.3,
      examCycleDurationMs: 86_400_000,
      admissionQuotaByLevel: { 3: 0.5, 4: 0.25, 5: 0.1 },
      vocationalTrackShare: 0.5,
      vocationalTrackJobTierBonus: { 2: 20, 3: 10 },
    });
    expect(manifest.policyRegistry.unregisteredParameterPaths).toEqual([]);
    expect(manifest.policyRegistry.unregisteredPolicyVersionKeys).toEqual([]);
    expect(manifest.policyRegistry.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          parameterPath: 'educationSystem',
          provenance: 'repository-defined',
          policyVersion: 'education-system-v3',
        }),
      ]),
    );

    // Canonical policies carry the enabled education system...
    const projection = createWorldProjection({
      agents: [createAgent({ index: 1, educationScore: 0 })],
    });
    expect(
      createAivilizationWorldCommandPolicies('seed')(projection).educationSystem,
    ).toMatchObject({
      policyVersion: 'education-system-v3',
      enabled: true,
      vocationalTrackJobTierBonus: { 2: 20, 3: 10 },
    });

    // ...and an explicit options override (paper-ablation baseline) wins.
    expect(
      createAivilizationWorldCommandPolicies('seed', undefined, undefined, {
        educationSystem: {
          policyVersion: 'education-system-v2',
          enabled: false,
          levelScoreThresholds: [20, 70, 180, 320, 450],
          compulsoryLevels: [1, 2],
          levelTuitionPerHour: { 0: 20, 1: 20, 2: 20, 3: 25, 4: 30, 5: 40 },
          employedStudyEfficiencyRatio: 0.3,
          examCycleDurationMs: 86_400_000,
          admissionQuotaByLevel: { 3: 0.5, 4: 0.25, 5: 0.1 },
          vocationalTrackShare: 0.5,
          source: 'test',
        },
      })(projection).educationSystem,
    ).toMatchObject({ enabled: false });
  });

  test('propagates an experiment seed into the resolved world policies', () => {
    const policies = createAivilizationWorldCommandPolicies('experiment-seed-42')(
      createWorldProjection({ agents: [createAgent({ index: 1, educationScore: 0 })] }),
    );

    expect(policies.randomSeed).toBe('experiment-seed-42');
  });

  test('binds authenticated participant quota into command and manifest policies', () => {
    const registration = {
      maxAgentsPerCreator: 16,
      creatorIdentityRule: 'authenticated-principal-subject' as const,
    };
    const policies = createAivilizationWorldCommandPolicies(
      'access-seed',
      registration,
    )(createWorldProjection({ agents: [createAgent({ index: 1, educationScore: 0 })] }));

    expect(policies.agentRegistration).toEqual({ maxAgentsPerCreator: 16 });
    expect(
      createAivilizationWorldPolicyManifest({ agentRegistration: registration }).parameters
        .agentRegistration,
    ).toMatchObject({
      policyVersion: 'runtime-agent-registration-v3',
      maximumAgentsPerCreator: 16,
      creatorQuotaAuthority: 'world-command-replay',
      creatorIdentityRule: 'authenticated-principal-subject',
    });
  });

  test('resolves source-backed physiology, labor, job, and recovery policies from projection state', () => {
    const resolvePolicies = createAivilizationWorldCommandPolicies();
    const policies = resolvePolicies(
      createWorldProjection({
        agents: [
          createAgent({ index: 1, educationScore: 0 }),
          createAgent({ index: 2, educationScore: 120 }),
          createAgent({ index: 3, educationScore: 240 }),
        ],
      }),
    );

    expect(policies.maxSatiety).toBe(500);
    expect(policies.educationInvestment).toEqual({
      currencyCostPerHour: 20,
      inventoryCostsPerHour: {},
    });
    expect(policies.sleep).toEqual({ energyRecoveryPerSecond: 1, maxEnergy: 500 });
    expect(policies.seeDoctor).toEqual({
      healthRecoveryPerSecond: 1,
      maxHealth: 500,
      treatmentCost: { currencyCostPerSecond: 0.02 },
    });
    expect(policies.production).toEqual({
      efficiency: {
        minEfficiency: 0.5,
        educationScoreForMaxEfficiency: 500,
        educationLevelMultipliers: [1, 1.2, 1.5, 2, 2.5, 3],
        physiologyCaps: {
          caps: [
            { residentialTier: 1, maxEnergy: 100, maxSatiety: 100, maxHealth: 100 },
            { residentialTier: 2, maxEnergy: 200, maxSatiety: 200, maxHealth: 200 },
            { residentialTier: 3, maxEnergy: 300, maxSatiety: 300, maxHealth: 300 },
            { residentialTier: 4, maxEnergy: 400, maxSatiety: 400, maxHealth: 400 },
            { residentialTier: 5, maxEnergy: 500, maxSatiety: 500, maxHealth: 500 },
            { residentialTier: 6, maxEnergy: 500, maxSatiety: 500, maxHealth: 500 },
          ],
        },
        residentialTierForMaxEfficiency: 5,
      },
    });
    expect(policies.tradeActivity).toEqual({ durationSeconds: 300 });
    expect(policies.satietyRecoveryByCommodity).toMatchObject({
      Apple: 25,
      Wheat: 25,
      Bread: 50,
      Sushi: 50,
    });
    expect(policies.satietyRecoveryByCommodity).not.toHaveProperty('Gold Apple');
    expect(policies.residentialPhysiologyCaps?.caps).toEqual([
      { residentialTier: 1, maxEnergy: 100, maxSatiety: 100, maxHealth: 100 },
      { residentialTier: 2, maxEnergy: 200, maxSatiety: 200, maxHealth: 200 },
      { residentialTier: 3, maxEnergy: 300, maxSatiety: 300, maxHealth: 300 },
      { residentialTier: 4, maxEnergy: 400, maxSatiety: 400, maxHealth: 400 },
      { residentialTier: 5, maxEnergy: 500, maxSatiety: 500, maxHealth: 500 },
      { residentialTier: 6, maxEnergy: 500, maxSatiety: 500, maxHealth: 500 },
    ]);
    expect(policies.jobApplication).toEqual({
      populationEducationScores: [0, 120, 240],
      quotaByResidentialTier: [1, 1, 2, 3, 4, 5],
      recruitmentCycle: {
        policyVersion: 'recruitment-cycle-v1',
        cycleDurationMs: 86_400_000,
        defaultOccupationCapacity: 1,
        occupationCapacityOverrides: {},
      },
    });
    expect(policies.residentialTierUpgrade?.maxResidentialTier).toBe(6);
    expect(policies.residentialTierUpgrade?.costs).toContainEqual({
      targetResidentialTier: 5,
      currencyCost: 500,
      minEducationScore: 180,
      inventoryCosts: { Transistor: 1 },
    });
    expect(policies.sleepDeprivation).toEqual({
      energyThreshold: 20,
      healthDecayPerSecond: 0.005,
      minHealth: 10,
    });
    expect(policies.stochasticIllness).toEqual({
      illnessProbabilityPercentPerHour: 1,
      healthDamage: 5,
      minHealth: 10,
    });
    expect(policies.residentialUpkeep).toEqual({
      policyVersion: 'residential-upkeep-v2',
      costs: [
        { residentialTier: 1, currencyCostPerHour: 0 },
        { residentialTier: 2, currencyCostPerHour: 20 },
        { residentialTier: 3, currencyCostPerHour: 40 },
        { residentialTier: 4, currencyCostPerHour: 80 },
        { residentialTier: 5, currencyCostPerHour: 160 },
        { residentialTier: 6, currencyCostPerHour: 320 },
      ],
      arrearsDowngradeThresholdHours: 72,
      landValueCoefficientPerHour: 1,
    });
    expect(policies.landValue).toEqual({
      policyVersion: 'land-value-v1',
      updateCadenceMs: 86_400_000,
      baseline: 0,
      populationWeight: 2,
      liquidityWeight: 1,
      smoothingFactor: 0.4,
      minIndex: 0,
      maxIndex: 100,
    });
    expect(policies.safetyNetSubsidy).toBeUndefined();
    expect(policies.tax).toEqual({
      policyVersion: 'tax-regime-v2',
      neutralRate: 0.1,
      incomeTaxBrackets: [
        { upToAmount: 300, rate: 0 },
        { upToAmount: 800, rate: 0.08 },
        { upToAmount: null, rate: 0.12 },
      ],
      tradeTaxRate: 0.05,
      dividendTaxRate: 0.1,
      source: aivilizationTaxPolicyDefaults.source,
    });
    expect(policies.lifestyle).toEqual({
      policyVersion: 'lifestyle-v1',
      netWorthBoundaries: [500, 2000, 10000],
      strugglingNonSurvivalSpendCapRatio: 0.3,
      source: aivilizationLifestylePolicyDefaults.source,
    });
    expect(policies.credit).toEqual({ ...aivilizationCreditPolicyDefaults });
    expect(policies.externalTrade).toEqual({ ...aivilizationExternalTradePolicyDefaults });
    expect(policies.physiologicalSafetyNet).toEqual({
      policyVersion: 'physiological-safety-net-v1',
      criticalThresholds: { satiety: 20, energy: 20, health: 20 },
      persistenceDurationMs: 3_600_000,
      grantCooldownMs: 21_600_000,
      essentialInventoryTargets: { Apple: 2 },
    });
    expect(policies.wageCalculator('Cleaner')).toBe(250);
    expect(policies.wageCalculator('CEO')).toBeCloseTo(2263.244);
  });

  test('uses the latest overall price index in both canonical wage regimes', () => {
    const projection = createWorldProjection({
      agents: [
        createAgent({ index: 1, educationScore: 0 }),
        createAgent({ index: 2, educationScore: 120 }),
        createAgent({ index: 3, educationScore: 240 }),
      ],
      marketPriceIndices: [
        {
          baselineAt: 0,
          recordedAt: 100,
          food: 2,
          nonFood: 2,
          overall: 2,
          foodCount: 1,
          nonFoodCount: 1,
          ratios: { Apple: 2, Books: 2 },
        },
      ],
    });
    const policies = createAivilizationWorldCommandPolicies()(projection);

    expect(policies.wageCalculator('Cleaner')).toBe(500);
    expect(policies.wageCalculator('CEO')).toBeCloseTo(4526.488);
  });

  test('pays a canonical high-tier worker with the projection-backed dynamic wage', () => {
    const projection = createWorldProjection({
      agents: [
        createAgent({ index: 1, educationScore: 0 }),
        createAgent({ index: 2, educationScore: 120 }),
        {
          ...createAgent({ index: 3, educationScore: 604 }),
          residentialTier: 6,
          job: 'CEO',
        },
      ],
      marketPriceIndices: [
        {
          baselineAt: 0,
          recordedAt: 100,
          food: 2,
          nonFood: 2,
          overall: 2,
          foodCount: 1,
          nonFoodCount: 1,
          ratios: { Apple: 2, Books: 2 },
        },
      ],
    });
    const policies = createAivilizationWorldCommandPolicies()(projection);

    const events = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'canonical-dynamic-wage',
        simulationId: 'sim-dynamic-wage',
        actorId: 'agent-3',
        type: 'AgentWork',
        payload: { occupationName: 'CEO', laborSeconds: 3600 },
        issuedAt: 20,
      }),
      projection,
      policies,
      nextSequence: 1,
    });
    const wagePaid = events.find((event) => event.type === 'WagePaid');
    if (wagePaid?.type !== 'WagePaid') {
      throw new Error('expected WagePaid event');
    }

    expect(wagePaid.payload.amount).toBeCloseTo(4526.488);
  });

  test('charges the versioned education investment policy on the canonical dispatch path', () => {
    const projection = createWorldProjection({
      moneySupply: 1_000,
      agents: [createAgent({ index: 1, educationScore: 0 })],
    });
    const policies = createAivilizationWorldCommandPolicies()(projection);

    const events = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'canonical-study-investment',
        simulationId: 'sim-education-investment',
        actorId: 'agent-1',
        type: 'AgentStudy',
        payload: { durationSeconds: 1800, educationRatePerSecond: 1 },
        issuedAt: 10,
      }),
      projection,
      policies,
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'EducationInvestmentPaid',
      'EducationChanged',
      'AgentActivityTimeCommitted',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]?.payload).toMatchObject({
      currencyCost: 10,
      previousBalance: 100,
      nextBalance: 90,
      consumedInventory: {},
    });
    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.agents['agent-1']).toMatchObject({ balance: 90, educationScore: 1800 });
    expect(updated.moneySupply).toBe(990);
  });

  test('batches canonical applications and competitively assigns capacity at the cycle boundary', () => {
    const resolvePolicies = createAivilizationWorldCommandPolicies();
    let projection = createWorldProjection({
      agents: [
        createAgent({ index: 1, educationScore: 100 }),
        createAgent({ index: 2, educationScore: 200 }),
      ],
    });
    let nextSequence = 1;

    for (const [index, agentId] of ['agent-1', 'agent-2'].entries()) {
      const events = dispatchWorldCommand({
        command: createCommandEnvelope({
          id: `canonical-job-application-${index + 1}`,
          simulationId: 'sim-recruitment',
          actorId: agentId,
          type: 'AgentApplyJob',
          payload: { occupationName: 'Cleaner' },
          issuedAt: 10 + index,
        }),
        projection,
        policies: resolvePolicies(projection),
        nextSequence,
      });
      expect(events.map((event) => event.type)).toEqual([
        'JobApplicationSubmitted',
        'ShortTermMemoryRecorded',
      ]);
      projection = events.reduce(applyWorldEvent, projection);
      nextSequence += events.length;
    }

    const quotaEvents = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'canonical-job-application-quota',
        simulationId: 'sim-recruitment',
        actorId: 'agent-1',
        type: 'AgentApplyJob',
        payload: { occupationName: 'Waiter' },
        issuedAt: 12,
      }),
      projection,
      policies: resolvePolicies(projection),
      nextSequence,
    });
    expect(quotaEvents[0]).toMatchObject({
      type: 'ActionRejected',
      payload: { reason: 'application quota exceeded: allowed 1, used 1' },
    });

    const recruitmentEvents = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'canonical-recruitment-cycle-boundary',
        simulationId: 'sim-recruitment',
        source: 'system',
        type: 'AdvanceSimulationTime',
        payload: { deltaMs: 86_400_000 },
        issuedAt: 86_400_000,
      }),
      projection,
      policies: resolvePolicies(projection),
      nextSequence,
    });
    projection = recruitmentEvents.reduce(applyWorldEvent, projection);

    expect(
      recruitmentEvents
        .filter((event) => event.type === 'JobApplicationResolved')
        .map((event) => event.payload),
    ).toEqual([
      expect.objectContaining({
        agentId: 'agent-2',
        occupationName: 'Cleaner',
        status: 'accepted',
        reason: 'competitive-match',
      }),
      expect.objectContaining({
        agentId: 'agent-1',
        occupationName: 'Cleaner',
        status: 'rejected',
        reason: 'capacity-exhausted',
      }),
    ]);
    const completedCycle = recruitmentEvents.find(
      (event) => event.type === 'RecruitmentCycleCompleted',
    );
    if (completedCycle?.type !== 'RecruitmentCycleCompleted') {
      throw new Error('expected RecruitmentCycleCompleted event');
    }
    expect(completedCycle.payload).toMatchObject({
      cycleNumber: 0,
      policyVersion: 'recruitment-cycle-v1',
      applicationCount: 2,
      acceptedCount: 1,
      rejectedCount: 1,
    });
    expect(projection.agents['agent-1']?.job).toBeNull();
    expect(projection.agents['agent-2']?.job).toBe('Cleaner');
    expect(projection.jobApplications.map((application) => application.status)).toEqual([
      'rejected',
      'accepted',
    ]);
    expect(projection.recruitmentCycles).toHaveLength(1);
  });

  test('grants canonical essentials only after persistent physiological distress and clears on recovery', () => {
    const resolvePolicies = createAivilizationWorldCommandPolicies();
    let projection = createWorldProjection({
      agents: [
        {
          ...createAgent({ index: 1, educationScore: 0 }),
          physiology: { energy: 500, satiety: 10, health: 500 },
        },
      ],
    });
    let nextSequence = 1;

    const firstHalf = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'canonical-safety-net-first-half',
        simulationId: 'sim-safety-net',
        source: 'system',
        type: 'AdvanceSimulationTime',
        payload: { deltaMs: 1_800_000 },
        issuedAt: 1_800_000,
      }),
      projection,
      policies: resolvePolicies(projection),
      nextSequence,
    });
    expect(firstHalf.some((event) => event.type === 'SafetyNetGranted')).toBe(false);
    expect(firstHalf).toContainEqual(
      expect.objectContaining({
        type: 'PhysiologicalDistressChanged',
      }),
    );
    projection = firstHalf.reduce(applyWorldEvent, projection);
    nextSequence += firstHalf.length;

    const secondHalf = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'canonical-safety-net-second-half',
        simulationId: 'sim-safety-net',
        source: 'system',
        type: 'AdvanceSimulationTime',
        payload: { deltaMs: 1_800_000 },
        issuedAt: 3_600_000,
      }),
      projection,
      policies: resolvePolicies(projection),
      nextSequence,
    });
    const grant = secondHalf.find((event) => event.type === 'SafetyNetGranted');
    if (grant?.type !== 'SafetyNetGranted') {
      throw new Error('expected SafetyNetGranted event');
    }
    expect(grant.payload).toMatchObject({
      agentId: 'agent-1',
      policyVersion: 'physiological-safety-net-v1',
      grantedAt: 3_600_000,
      distressDurationMs: 3_600_000,
      lowAxes: ['satiety'],
      inventory: { Apple: 2 },
    });
    projection = secondHalf.reduce(applyWorldEvent, projection);
    nextSequence += secondHalf.length;
    expect(projection.agents['agent-1']?.inventory).toEqual({ Apple: 2 });
    expect(projection.physiologicalDistressByAgent['agent-1']?.lastGrantedAt).toBe(3_600_000);

    const eatEvents = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'canonical-safety-net-recovery-eat',
        simulationId: 'sim-safety-net',
        actorId: 'agent-1',
        type: 'AgentEat',
        payload: { commodityName: 'Apple', quantity: 1 },
        issuedAt: 3_600_001,
      }),
      projection,
      policies: resolvePolicies(projection),
      nextSequence,
    });
    projection = eatEvents.reduce(applyWorldEvent, projection);
    nextSequence += eatEvents.length;

    const recoveryEvents = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'canonical-safety-net-recovery-check',
        simulationId: 'sim-safety-net',
        source: 'system',
        type: 'AdvanceSimulationTime',
        payload: { deltaMs: 1_000 },
        issuedAt: 3_601_000,
      }),
      projection,
      policies: resolvePolicies(projection),
      nextSequence,
    });
    const recovery = recoveryEvents.find(
      (event) =>
        event.type === 'PhysiologicalDistressChanged' && event.payload.status === 'cleared',
    );
    if (recovery?.type !== 'PhysiologicalDistressChanged') {
      throw new Error('expected cleared PhysiologicalDistressChanged event');
    }
    expect(recovery.payload).toMatchObject({ status: 'cleared', reason: 'recovered' });
    projection = recoveryEvents.reduce(applyWorldEvent, projection);
    expect(projection.physiologicalDistressByAgent['agent-1']).toBeUndefined();
    expect(projection.agents['agent-1']?.physiology.satiety).toBe(35);
  });
});

function createAgent(input: { readonly index: number; readonly educationScore: number }) {
  return {
    agentId: asAgentId(`agent-${input.index}`),
    physiology: { energy: 500, satiety: 500, health: 500 },
    educationScore: input.educationScore,
    balance: 100,
    residentialTier: 1,
    job: null,
    inventory: {},
  };
}
