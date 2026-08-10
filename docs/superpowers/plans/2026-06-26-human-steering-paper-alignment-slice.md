# Human Steering Paper Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote AIvilization paper section 2.3 Human-in-the-Loop Steering from side-channel experiment validation into first-class paper-alignment coverage.

**Architecture:** Keep steering execution owned by worker/API modules and keep paper-alignment reporting in the server gate suite. The coverage layer will consume the already-produced `steering-memory-propagation` experiment metric and expose separate strategic and reactive steering capability rows, avoiding any fake pass based only on code paths or config presence.

**Tech Stack:** TypeScript, Vitest, pnpm, existing `@aivilization/observability` experiment validation summaries, existing server profile gate suite.

---

### Task 1: Add RED Coverage Tests For Steering Alignment

**Files:**
- Modify: `apps/server/src/localRuntimeTownProfileGateSuite.test.ts`

- [x] **Step 1: Write failing tests**

Add tests near the existing paper-alignment tests:

```ts
test('marks human steering paper capabilities as passed from steering memory propagation evidence', async () => {
  const rootDir = createRootDir();
  const reportRootDir = createRootDir();

  const result = await runLocalRuntimeTownProfileGateSuite({
    rootDir,
    reportRootDir,
    requestedAt: 410,
    reportGeneratedAt: 510,
    cycleCount: 1,
    profileIds: ['smoke-25'],
    experimentValidation: true,
    runProfile: (input) =>
      Promise.resolve(
        createPassingSummary(input, {
          experimentValidationReports: [
            createSteeringMemoryPropagationReport({
              input,
              status: 'pass',
              humanTraceCount: 2,
              longHorizonTraceCount: 1,
              reactiveTraceCount: 1,
              planBackedLongHorizonTraceCount: 1,
              memoryBackedReactiveTraceCount: 1,
              commandDraftBackedReactiveTraceCount: 1,
            }),
          ],
        }),
      ),
  });

  expect(result.bundleManifest?.paperAlignment).toMatchObject({
    schemaVersion: 1,
    capabilityCount: 14,
    configuredCapabilityCount: 2,
    passedConfiguredCapabilityCount: 2,
    failedConfiguredCapabilityCount: 0,
  });
  expect(result.bundleManifest?.profiles[0]?.paperAlignment.stages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        paperCapabilityId: 'strategic-steering',
        paperSection: '2.3 Human-in-the-Loop Steering',
        stageFamily: 'human-steering',
        stageName: 'strategicSteering',
        runtimeConfigured: true,
        gateStatus: 'pass',
        steeringRequirements: expect.objectContaining({
          memoryPropagationMetric: true,
          metricStatus: 'pass',
          humanTraceCount: 2,
          longHorizonTraceCount: 1,
          planBackedLongHorizonTraceCount: 1,
        }),
      }),
      expect.objectContaining({
        paperCapabilityId: 'reactive-steering',
        paperSection: '2.3 Human-in-the-Loop Steering',
        stageFamily: 'human-steering',
        stageName: 'reactiveSteering',
        runtimeConfigured: true,
        gateStatus: 'pass',
        steeringRequirements: expect.objectContaining({
          memoryPropagationMetric: true,
          metricStatus: 'pass',
          humanTraceCount: 2,
          reactiveTraceCount: 1,
          memoryBackedReactiveTraceCount: 1,
          commandDraftBackedReactiveTraceCount: 1,
        }),
      }),
    ]),
  );
});

test('fails configured steering paper capabilities when propagation evidence is watch', async () => {
  const rootDir = createRootDir();
  const reportRootDir = createRootDir();

  const result = await runLocalRuntimeTownProfileGateSuite({
    rootDir,
    reportRootDir,
    requestedAt: 411,
    reportGeneratedAt: 511,
    cycleCount: 1,
    profileIds: ['smoke-25'],
    experimentValidation: true,
    runProfile: (input) =>
      Promise.resolve(
        createPassingSummary(input, {
          experimentValidationReports: [
            createSteeringMemoryPropagationReport({
              input,
              status: 'watch',
              humanTraceCount: 2,
              longHorizonTraceCount: 1,
              reactiveTraceCount: 1,
              planBackedLongHorizonTraceCount: 1,
              memoryBackedReactiveTraceCount: 0,
              commandDraftBackedReactiveTraceCount: 1,
            }),
          ],
        }),
      ),
  });

  const stages = result.bundleManifest?.profiles[0]?.paperAlignment.stages ?? [];
  expect(stages.find((stage) => stage.paperCapabilityId === 'strategic-steering')).toMatchObject({
    runtimeConfigured: true,
    gateStatus: 'fail',
  });
  expect(stages.find((stage) => stage.paperCapabilityId === 'reactive-steering')).toMatchObject({
    runtimeConfigured: true,
    gateStatus: 'fail',
  });
});
```

Also extend `createPassingSummary` options:

```ts
readonly experimentValidationReports?: LocalRuntimeTownProfileRunnerSummary['experimentValidationReports'];
```

and return:

```ts
...(options.experimentValidationReports === undefined
  ? {}
  : { experimentValidationReports: options.experimentValidationReports }),
```

Add helper:

```ts
function createSteeringMemoryPropagationReport(input: {
  readonly input: LocalRuntimeTownProfileRunnerInput;
  readonly status: 'pass' | 'watch' | 'fail';
  readonly humanTraceCount: number;
  readonly longHorizonTraceCount: number;
  readonly reactiveTraceCount: number;
  readonly planBackedLongHorizonTraceCount: number;
  readonly memoryBackedReactiveTraceCount: number;
  readonly commandDraftBackedReactiveTraceCount: number;
}): NonNullable<LocalRuntimeTownProfileRunnerSummary['experimentValidationReports']>[number] {
  return {
    simulationId: `aivilization-${input.input.profileId}`,
    partitionKey: 'world-main',
    runId: `aivilization-${input.input.profileId}:steering-validation:${input.input.requestedAt}`,
    generatedAt: input.input.reportGeneratedAt ?? input.input.requestedAt,
    source: 'local-runtime-profile-validation',
    gateStatus: input.status,
    gateFailureCount: input.status === 'pass' ? 0 : 1,
    metricStatusCounts: {
      pass: input.status === 'pass' ? 1 : 0,
      watch: input.status === 'watch' ? 1 : 0,
      fail: input.status === 'fail' ? 1 : 0,
    },
    metrics: [
      {
        id: 'steering-memory-propagation',
        label: 'Steering memory propagation',
        status: input.status,
        value: 1,
        unit: 'covered expected-agent ratio',
        evidence: {
          traceCount: input.humanTraceCount,
          humanTraceCount: input.humanTraceCount,
          expectedAgentCount: 1,
          coveredAgentCount: 1,
          agentCoverageRatio: 1,
          longHorizonTraceCount: input.longHorizonTraceCount,
          reactiveTraceCount: input.reactiveTraceCount,
          planBackedLongHorizonTraceCount: input.planBackedLongHorizonTraceCount,
          memoryBackedReactiveTraceCount: input.memoryBackedReactiveTraceCount,
          commandDraftBackedReactiveTraceCount: input.commandDraftBackedReactiveTraceCount,
          latestIssuedAt: input.input.requestedAt,
        },
      },
    ],
    streamVersion: 3,
    fromSequence: 0,
    toSequence: 3,
    eventCount: 3,
    projectionSequence: 3,
  };
}
```

- [x] **Step 2: Run RED test**

Run:

```bash
pnpm vitest run apps/server/src/localRuntimeTownProfileGateSuite.test.ts -t "steering paper capabilities"
```

Expected: FAIL because paper-alignment stages do not include `strategic-steering` or `reactive-steering`.

### Task 2: Implement Steering Coverage In Paper Alignment

**Files:**
- Modify: `apps/server/src/localRuntimeTownPaperAlignmentCoverage.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGateSuite.ts`

- [x] **Step 1: Extend coverage types**

Add a `human-steering` stage family and steering requirements:

```ts
export type LocalRuntimeTownPaperAlignmentStageFamily =
  | 'agent-cycle'
  | 'cognition'
  | 'human-steering';

export type LocalRuntimeTownPaperAlignmentSteeringRequirements = {
  readonly memoryPropagationMetric: boolean;
  readonly metricStatus: 'pass' | 'watch' | 'fail' | 'missing';
  readonly humanTraceCount: number;
  readonly longHorizonTraceCount: number;
  readonly reactiveTraceCount: number;
  readonly planBackedLongHorizonTraceCount: number;
  readonly memoryBackedReactiveTraceCount: number;
  readonly commandDraftBackedReactiveTraceCount: number;
};
```

Add optional `steeringRequirements` to `LocalRuntimeTownPaperAlignmentStageCoverage`.

- [x] **Step 2: Accept experiment validation reports**

Change `createLocalRuntimeTownPaperAlignmentProfileCoverage` input to:

```ts
readonly experimentValidationReports?: readonly LocalRuntimeTownPaperAlignmentExperimentValidationReport[];
```

Define local minimal metric/report types in `localRuntimeTownPaperAlignmentCoverage.ts` to avoid coupling to runner internals.

- [x] **Step 3: Add stage definitions**

Add:

```ts
{
  paperCapabilityId: 'strategic-steering',
  paperSection: '2.3 Human-in-the-Loop Steering',
  stageFamily: 'human-steering',
  stageName: 'strategicSteering',
},
{
  paperCapabilityId: 'reactive-steering',
  paperSection: '2.3 Human-in-the-Loop Steering',
  stageFamily: 'human-steering',
  stageName: 'reactiveSteering',
},
```

- [x] **Step 4: Implement metric extraction and stage status**

Add helpers that find the latest or strongest `steering-memory-propagation` metric. The stage is:
- `not-configured` when no metric exists or no relevant trace count exists.
- `pass` only when the metric status is `pass` and the stage-specific evidence is complete.
- `fail` when evidence exists but metric status is not `pass` or required propagation counts are missing.

- [x] **Step 5: Pass validation summaries from gate suite**

When creating `paperAlignment` in `runLocalRuntimeTownProfileGateSuite`, pass:

```ts
...(summary.experimentValidationReports === undefined
  ? {}
  : { experimentValidationReports: summary.experimentValidationReports }),
```

- [x] **Step 6: Run GREEN tests**

Run:

```bash
pnpm vitest run apps/server/src/localRuntimeTownProfileGateSuite.test.ts -t "steering paper capabilities"
```

Expected: PASS.

### Task 3: Update Existing Paper-Alignment Expectations

**Files:**
- Modify: `apps/server/src/localRuntimeTownProfileGateSuite.test.ts`

- [x] **Step 1: Adjust existing 12-capability assertions**

Where tests use full scripted LLM config without experiment validation, update expectations from 12 total capabilities to 14 total capabilities, with 12 configured and 2 unconfigured. This preserves the distinction between LLM runtime coverage and §2.3 steering validation.

- [x] **Step 2: Run focused paper-alignment tests**

Run:

```bash
pnpm vitest run apps/server/src/localRuntimeTownProfileGateSuite.test.ts -t "paper-alignment|steering paper capabilities"
```

Expected: PASS.

### Task 4: Verify, Review Architecture, Commit

**Files:**
- Modified files from Tasks 1-3

- [x] **Step 1: Run verification**

Run:

```bash
pnpm typecheck
pnpm lint
pnpm test
```

Expected: all commands exit 0.

- [x] **Step 2: Review architecture**

Confirm:
- `apps/worker/src/steering.ts` still owns execution behavior.
- `packages/observability/src/experimentValidation.ts` still owns steering metric semantics.
- `apps/server/src/localRuntimeTownPaperAlignmentCoverage.ts` only maps evidence to paper capabilities.
- No production behavior changed for agent cycle execution.

- [x] **Step 3: Commit**

Use a detailed Conventional Commit message:

```bash
git add apps/server/src/localRuntimeTownPaperAlignmentCoverage.ts apps/server/src/localRuntimeTownProfileGateSuite.ts apps/server/src/localRuntimeTownProfileGateSuite.test.ts docs/superpowers/plans/2026-06-26-human-steering-paper-alignment-slice.md
git commit -m "feat(runtime): 将 human steering 纳入论文对齐验收"
```

Commit body must mention why, modules changed, design semantics, user-visible report changes, and tests actually run.
