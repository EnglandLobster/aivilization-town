# Architecture Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first runnable, large-game-backend-ready monorepo skeleton for AIvilization Town with deterministic command/event interfaces, package boundaries, content config shape, and verification gates.

**Architecture:** Use a pnpm TypeScript workspace with `apps/*` and `packages/*`. The first milestone creates a server-authoritative command/event spine with partition, idempotency, snapshot, replay, and trace contracts before implementing economy, society, Agent runtime, memory, LLM, or UI feature depth.

**Tech Stack:** pnpm workspaces, TypeScript, Vitest, tsup, ESLint, Prettier, Node.js ESM packages.

---

## Scope

This plan implements Phase 1 from `docs/superpowers/specs/2026-06-23-aivilization-town-design.md`.
It creates the foundation required by the full AIvilization goal:

- Package boundaries for `sim-core`, `economy`, `society`, `agent-runtime`, `memory`, `llm`,
  `content`, and `observability`.
- App package shells for `web`, `api`, and `worker`.
- Deterministic command/event primitives in `sim-core`.
- Backend-grade partition, idempotency, and snapshot contracts for replayable worker execution.
- Source-derived configuration shape in `content`.
- Trace shape in `observability`.
- Tests that prove the initial boundaries compile and remain deterministic.

The plan does not implement the full AMM, production system, occupation system, planner, memory
consolidation, or browser UI. Those follow as separate implementation plans after this skeleton is
merged.

## File Structure

- Create `package.json`: root scripts and dev dependencies.
- Create `pnpm-workspace.yaml`: workspace package discovery.
- Create `tsconfig.base.json`: shared TypeScript defaults.
- Create `.prettierrc.json`: formatting contract.
- Create `eslint.config.js`: linting contract.
- Create `vitest.workspace.ts`: test workspace.
- Create `packages/*/package.json`: package definitions.
- Create `packages/*/tsconfig.json`: package TypeScript configs.
- Create `packages/*/src/index.ts`: package public exports.
- Create `packages/sim-core/src/ids.ts`: branded ids.
- Create `packages/sim-core/src/time.ts`: simulation clock types.
- Create `packages/sim-core/src/partition.ts`: simulation partition and stream position contracts.
- Create `packages/sim-core/src/command.ts`: command envelope contracts.
- Create `packages/sim-core/src/event.ts`: event envelope contracts.
- Create `packages/sim-core/src/snapshot.ts`: replay checkpoint and snapshot reference contracts.
- Create `packages/sim-core/src/replay.ts`: deterministic replay helper.
- Create `packages/sim-core/src/replay.test.ts`: replay determinism tests.
- Create `packages/content/src/commodities.ts`: paper commodity config subset and source metadata.
- Create `packages/content/src/activities.ts`: paper activity config.
- Create `packages/content/src/jobs.ts`: paper job tier and occupation config subset.
- Create `packages/content/src/index.ts`: content exports.
- Create `packages/content/src/content.test.ts`: source-derived config tests.
- Create `packages/observability/src/agentCycleTrace.ts`: trace contract.
- Create `packages/observability/src/index.ts`: trace exports.
- Create `packages/observability/src/agentCycleTrace.test.ts`: trace shape tests.
- Create `apps/api/package.json`, `apps/worker/package.json`, `apps/web/package.json`: app package
  shells.
- Create `apps/*/src/index.ts`: minimal app entrypoints that import package contracts.

## Task 1: Workspace Tooling

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.prettierrc.json`
- Create: `eslint.config.js`
- Create: `vitest.workspace.ts`

- [ ] **Step 1: Write the root workspace files**

Create `package.json`:

```json
{
  "name": "aivilization-town",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "pnpm -r --sort build",
    "check": "pnpm lint && pnpm typecheck && pnpm test",
    "format": "prettier --write .",
    "lint": "eslint .",
    "test": "vitest run",
    "typecheck": "pnpm -r --sort typecheck"
  },
  "devDependencies": {
    "@eslint/js": "^9.30.0",
    "@types/node": "^24.0.0",
    "eslint": "^9.30.0",
    "prettier": "^3.5.3",
    "tsup": "^8.5.0",
    "typescript": "^5.8.3",
    "typescript-eslint": "^8.35.0",
    "vitest": "^3.2.4"
  },
  "packageManager": "pnpm@10.12.4"
}
```

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

Create `.prettierrc.json`:

```json
{
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100
}
```

Create `eslint.config.js`:

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**'],
  },
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
);
```

Create `vitest.workspace.ts`:

```ts
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace(['packages/*/vitest.config.ts']);
```

- [ ] **Step 2: Install dependencies**

Run:

```bash
corepack enable
pnpm install
```

Expected: `pnpm-lock.yaml` is created and dependencies install successfully.

- [ ] **Step 3: Run check to verify workspace is not complete yet**

Run:

```bash
pnpm check
```

Expected: FAIL because workspace packages have not been created.

- [ ] **Step 4: Commit workspace tooling**

Run:

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json .prettierrc.json eslint.config.js vitest.workspace.ts
git commit -m "chore: add workspace tooling"
```

## Task 2: Package Shells

**Files:**
- Create: `packages/sim-core/package.json`
- Create: `packages/economy/package.json`
- Create: `packages/society/package.json`
- Create: `packages/agent-runtime/package.json`
- Create: `packages/memory/package.json`
- Create: `packages/llm/package.json`
- Create: `packages/content/package.json`
- Create: `packages/observability/package.json`
- Create: `packages/*/tsconfig.json`
- Create: `packages/*/vitest.config.ts`
- Create: `packages/economy/src/index.ts`
- Create: `packages/society/src/index.ts`
- Create: `packages/agent-runtime/src/index.ts`
- Create: `packages/memory/src/index.ts`
- Create: `packages/llm/src/index.ts`

- [ ] **Step 1: Create package manifests**

For `packages/sim-core/package.json`, use:

```json
{
  "name": "@aivilization/sim-core",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

For each domain shell package, use the same structure with its package name:

```json
{
  "name": "@aivilization/economy",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@aivilization/sim-core": "workspace:*"
  }
}
```

Use this package name mapping:

- `@aivilization/economy`
- `@aivilization/society`
- `@aivilization/agent-runtime`
- `@aivilization/memory`
- `@aivilization/llm`
- `@aivilization/content`
- `@aivilization/observability`

For `@aivilization/content`, depend on `@aivilization/sim-core`.
For `@aivilization/observability`, depend on `@aivilization/sim-core`.

- [ ] **Step 2: Create shared package TypeScript and Vitest configs**

For each package, create `tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"]
}
```

For each package, create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
});
```

- [ ] **Step 3: Create shell exports for non-core packages**

Create `packages/economy/src/index.ts`:

```ts
export type EconomyModuleStatus = {
  readonly packageName: '@aivilization/economy';
  readonly owns: 'commodities-production-markets';
};
```

Create `packages/society/src/index.ts`:

```ts
export type SocietyModuleStatus = {
  readonly packageName: '@aivilization/society';
  readonly owns: 'education-occupation-relationships';
};
```

Create `packages/agent-runtime/src/index.ts`:

```ts
export type AgentRuntimeModuleStatus = {
  readonly packageName: '@aivilization/agent-runtime';
  readonly owns: 'planning-simulation-replanning';
};
```

Create `packages/memory/src/index.ts`:

```ts
export type MemoryModuleStatus = {
  readonly packageName: '@aivilization/memory';
  readonly owns: 'stm-ltm-profile-consolidation';
};
```

Create `packages/llm/src/index.ts`:

```ts
export type LlmModuleStatus = {
  readonly packageName: '@aivilization/llm';
  readonly owns: 'providers-structured-output-tool-contracts';
};
```

- [ ] **Step 4: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: FAIL because `packages/sim-core/src/index.ts`, `packages/content/src/index.ts`, and
`packages/observability/src/index.ts` are not created yet.

- [ ] **Step 5: Commit package shells**

Run:

```bash
git add packages
git commit -m "chore: add package shells"
```

## Task 3: Deterministic Sim Core Contracts

**Files:**
- Create: `packages/sim-core/src/ids.ts`
- Create: `packages/sim-core/src/time.ts`
- Create: `packages/sim-core/src/partition.ts`
- Create: `packages/sim-core/src/command.ts`
- Create: `packages/sim-core/src/event.ts`
- Create: `packages/sim-core/src/snapshot.ts`
- Create: `packages/sim-core/src/replay.ts`
- Create: `packages/sim-core/src/index.ts`
- Create: `packages/sim-core/src/replay.test.ts`

- [ ] **Step 1: Write failing replay determinism test**

Create `packages/sim-core/src/replay.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import {
  createCommandEnvelope,
  createEventEnvelope,
  createSimulationPartition,
  createSnapshotReference,
  replayEvents,
} from './index';

describe('replayEvents', () => {
  test('replays ordered event envelopes into a deterministic projection', () => {
    const command = createCommandEnvelope({
      id: 'cmd-1',
      simulationId: 'sim-1',
      actorId: 'agent-1',
      type: 'AdvanceSimulationTime',
      payload: { deltaMs: 1000 },
      issuedAt: 0,
    });
    const partition = createSimulationPartition({
      simulationId: command.simulationId,
      partitionKey: 'world-main',
    });

    const event = createEventEnvelope({
      id: 'evt-1',
      simulationId: command.simulationId,
      commandId: command.id,
      type: 'SimulationTimeAdvanced',
      payload: { now: 1000 },
      occurredAt: 1000,
      sequence: 1,
    });
    const snapshot = createSnapshotReference({
      simulationId: command.simulationId,
      partitionKey: partition.partitionKey,
      sequence: 1,
      uri: 'file://snapshots/sim-1/world-main/1.json',
      createdAt: 1000,
    });

    const first = replayEvents(
      { now: 0, appliedEventIds: [] as string[] },
      [event],
      (projection, current) => ({
        now: current.payload.now,
        appliedEventIds: [...projection.appliedEventIds, current.id],
      }),
    );
    const second = replayEvents(
      { now: 0, appliedEventIds: [] as string[] },
      [event],
      (projection, current) => ({
        now: current.payload.now,
        appliedEventIds: [...projection.appliedEventIds, current.id],
      }),
    );

    expect(command.idempotencyKey).toBe('cmd-1');
    expect(partition.eventStreamName).toBe('simulation/sim-1/partition/world-main/events');
    expect(snapshot.sequence).toBe(1);
    expect(second).toEqual(first);
    expect(first).toEqual({ now: 1000, appliedEventIds: ['evt-1'] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @aivilization/sim-core test
```

Expected: FAIL with missing exported functions from `./index`.

- [ ] **Step 3: Implement branded ids**

Create `packages/sim-core/src/ids.ts`:

```ts
export type Brand<TValue, TBrand extends string> = TValue & { readonly __brand: TBrand };

export type SimulationId = Brand<string, 'SimulationId'>;
export type AgentId = Brand<string, 'AgentId'>;
export type CommandId = Brand<string, 'CommandId'>;
export type CommandIdempotencyKey = Brand<string, 'CommandIdempotencyKey'>;
export type EventId = Brand<string, 'EventId'>;

export function asSimulationId(value: string): SimulationId {
  return value as SimulationId;
}

export function asAgentId(value: string): AgentId {
  return value as AgentId;
}

export function asCommandId(value: string): CommandId {
  return value as CommandId;
}

export function asCommandIdempotencyKey(value: string): CommandIdempotencyKey {
  return value as CommandIdempotencyKey;
}

export function asEventId(value: string): EventId {
  return value as EventId;
}
```

- [ ] **Step 4: Implement simulation time**

Create `packages/sim-core/src/time.ts`:

```ts
export type SimulationTimestamp = number;

export type SimulationClock = {
  readonly now: SimulationTimestamp;
  readonly tickDurationMs: number;
};

export function advanceClock(clock: SimulationClock, deltaMs: number): SimulationClock {
  if (!Number.isFinite(deltaMs) || deltaMs < 0) {
    throw new Error(`deltaMs must be a non-negative finite number, received ${deltaMs}`);
  }
  return { ...clock, now: clock.now + deltaMs };
}
```

- [ ] **Step 5: Implement simulation partitions**

Create `packages/sim-core/src/partition.ts`:

```ts
import { asSimulationId, type SimulationId } from './ids';

export type PartitionKey = string;

export type SimulationPartition = {
  readonly simulationId: SimulationId;
  readonly partitionKey: PartitionKey;
  readonly commandStreamName: string;
  readonly eventStreamName: string;
};

export type StreamPosition = {
  readonly simulationId: SimulationId;
  readonly partitionKey: PartitionKey;
  readonly sequence: number;
};

export function createSimulationPartition(input: {
  readonly simulationId: string;
  readonly partitionKey: PartitionKey;
}): SimulationPartition {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(input.partitionKey)) {
    throw new Error(`partitionKey must be lowercase kebab-case, received ${input.partitionKey}`);
  }

  return {
    simulationId: asSimulationId(input.simulationId),
    partitionKey: input.partitionKey,
    commandStreamName: `simulation/${input.simulationId}/partition/${input.partitionKey}/commands`,
    eventStreamName: `simulation/${input.simulationId}/partition/${input.partitionKey}/events`,
  };
}
```

- [ ] **Step 6: Implement command contracts**

Create `packages/sim-core/src/command.ts`:

```ts
import {
  asAgentId,
  asCommandId,
  asCommandIdempotencyKey,
  asSimulationId,
  type AgentId,
  type CommandId,
  type CommandIdempotencyKey,
  type SimulationId,
} from './ids';
import type { SimulationTimestamp } from './time';

export type CoreCommandType =
  | 'AgentProduce'
  | 'AgentTrade'
  | 'AgentEat'
  | 'AgentSleep'
  | 'AgentStudy'
  | 'AgentApplyJob'
  | 'AgentWork'
  | 'AgentSocialize'
  | 'SetLongHorizonObjective'
  | 'IssueReactiveCommand'
  | 'AdvanceSimulationTime';

export type CommandSource = 'human' | 'agent-runtime' | 'system' | 'experiment';

export type CommandEnvelope<TType extends string = CoreCommandType, TPayload = unknown> = {
  readonly id: CommandId;
  readonly simulationId: SimulationId;
  readonly idempotencyKey: CommandIdempotencyKey;
  readonly actorId?: AgentId;
  readonly source: CommandSource;
  readonly type: TType;
  readonly payload: TPayload;
  readonly issuedAt: SimulationTimestamp;
  readonly expectedVersion?: number;
};

export function createCommandEnvelope<TType extends string, TPayload>(input: {
  readonly id: string;
  readonly simulationId: string;
  readonly idempotencyKey?: string;
  readonly actorId?: string;
  readonly source?: CommandSource;
  readonly type: TType;
  readonly payload: TPayload;
  readonly issuedAt: SimulationTimestamp;
  readonly expectedVersion?: number;
}): CommandEnvelope<TType, TPayload> {
  const base = {
    id: asCommandId(input.id),
    simulationId: asSimulationId(input.simulationId),
    idempotencyKey: asCommandIdempotencyKey(input.idempotencyKey ?? input.id),
    source: input.source ?? 'system',
    type: input.type,
    payload: input.payload,
    issuedAt: input.issuedAt,
  };

  const withActor = input.actorId === undefined ? base : { ...base, actorId: asAgentId(input.actorId) };
  return input.expectedVersion === undefined
    ? withActor
    : { ...withActor, expectedVersion: input.expectedVersion };
}
```

- [ ] **Step 7: Implement event contracts**

Create `packages/sim-core/src/event.ts`:

```ts
import { asCommandId, asEventId, asSimulationId, type CommandId, type EventId, type SimulationId } from './ids';
import type { PartitionKey } from './partition';
import type { SimulationTimestamp } from './time';

export type CoreEventType =
  | 'CommodityProduced'
  | 'TradeExecuted'
  | 'PhysiologyChanged'
  | 'EducationChanged'
  | 'JobApplicationSubmitted'
  | 'JobAssigned'
  | 'WagePaid'
  | 'SocialInteractionCompleted'
  | 'ShortTermMemoryRecorded'
  | 'LongTermMemoryConsolidated'
  | 'PlannerBranchUpdated'
  | 'ActionRejected'
  | 'ActionRepaired'
  | 'SimulationTimeAdvanced';

export type EventEnvelope<TType extends string = CoreEventType, TPayload = unknown> = {
  readonly id: EventId;
  readonly simulationId: SimulationId;
  readonly partitionKey?: PartitionKey;
  readonly commandId?: CommandId;
  readonly type: TType;
  readonly payload: TPayload;
  readonly occurredAt: SimulationTimestamp;
  readonly sequence: number;
};

export function createEventEnvelope<TType extends string, TPayload>(input: {
  readonly id: string;
  readonly simulationId: string;
  readonly partitionKey?: PartitionKey;
  readonly commandId?: string;
  readonly type: TType;
  readonly payload: TPayload;
  readonly occurredAt: SimulationTimestamp;
  readonly sequence: number;
}): EventEnvelope<TType, TPayload> {
  if (!Number.isInteger(input.sequence) || input.sequence < 1) {
    throw new Error(`event sequence must be a positive integer, received ${input.sequence}`);
  }

  const base = {
    id: asEventId(input.id),
    simulationId: asSimulationId(input.simulationId),
    type: input.type,
    payload: input.payload,
    occurredAt: input.occurredAt,
    sequence: input.sequence,
  };

  const withCommand =
    input.commandId === undefined ? base : { ...base, commandId: asCommandId(input.commandId) };
  return input.partitionKey === undefined
    ? withCommand
    : { ...withCommand, partitionKey: input.partitionKey };
}
```

- [ ] **Step 8: Implement snapshot contracts**

Create `packages/sim-core/src/snapshot.ts`:

```ts
import { asSimulationId, type SimulationId } from './ids';
import type { PartitionKey } from './partition';
import type { SimulationTimestamp } from './time';

export type SnapshotReference = {
  readonly simulationId: SimulationId;
  readonly partitionKey: PartitionKey;
  readonly sequence: number;
  readonly uri: string;
  readonly createdAt: SimulationTimestamp;
};

export type ProjectionCheckpoint = {
  readonly simulationId: SimulationId;
  readonly partitionKey: PartitionKey;
  readonly lastAppliedSequence: number;
  readonly snapshot?: SnapshotReference;
};

export function createSnapshotReference(input: {
  readonly simulationId: string;
  readonly partitionKey: PartitionKey;
  readonly sequence: number;
  readonly uri: string;
  readonly createdAt: SimulationTimestamp;
}): SnapshotReference {
  if (!Number.isInteger(input.sequence) || input.sequence < 0) {
    throw new Error(`snapshot sequence must be a non-negative integer, received ${input.sequence}`);
  }
  if (input.uri.length === 0) {
    throw new Error('snapshot uri must not be empty');
  }

  return {
    simulationId: asSimulationId(input.simulationId),
    partitionKey: input.partitionKey,
    sequence: input.sequence,
    uri: input.uri,
    createdAt: input.createdAt,
  };
}
```

- [ ] **Step 9: Implement replay helper**

Create `packages/sim-core/src/replay.ts`:

```ts
import type { EventEnvelope } from './event';

export function replayEvents<TProjection, TEvent extends EventEnvelope>(
  initialProjection: TProjection,
  events: readonly TEvent[],
  apply: (projection: TProjection, event: TEvent) => TProjection,
): TProjection {
  const ordered = [...events].sort((left, right) => left.sequence - right.sequence);
  return ordered.reduce<TProjection>((projection, event) => apply(projection, event), initialProjection);
}
```

- [ ] **Step 10: Export sim-core contracts**

Create `packages/sim-core/src/index.ts`:

```ts
export * from './command';
export * from './event';
export * from './ids';
export * from './partition';
export * from './replay';
export * from './snapshot';
export * from './time';
```

- [ ] **Step 11: Run sim-core tests**

Run:

```bash
pnpm --filter @aivilization/sim-core test
pnpm --filter @aivilization/sim-core typecheck
```

Expected: PASS.

- [ ] **Step 12: Commit sim-core contracts**

Run:

```bash
git add packages/sim-core
git commit -m "feat: add deterministic sim core contracts"
```

## Task 4: Source-Derived Content Contracts

**Files:**
- Create: `packages/content/src/commodities.ts`
- Create: `packages/content/src/activities.ts`
- Create: `packages/content/src/jobs.ts`
- Create: `packages/content/src/index.ts`
- Create: `packages/content/src/content.test.ts`

- [ ] **Step 1: Write failing content test**

Create `packages/content/src/content.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { activities, commodities, jobTiers, occupations, productionRecipes } from './index';

describe('AIvilization source content', () => {
  test('includes the paper commodity chain anchors', () => {
    expect(commodities.map((commodity) => commodity.name)).toContain('Apple');
    expect(commodities.map((commodity) => commodity.name)).toContain('Chip');
    expect(productionRecipes.find((recipe) => recipe.output === 'Chip')).toMatchObject({
      output: 'Chip',
      energyCost: 100,
      satietyCost: 25,
      timeCostSeconds: 5,
      rewardProbabilityPercent: 5,
    });
  });

  test('includes paper activity and occupation anchors', () => {
    expect(activities.map((activity) => activity.type)).toContain('Trade');
    expect(jobTiers.find((tier) => tier.tier === 6)).toMatchObject({
      tierName: 'Leadership',
      minResidentialTier: 6,
      minEducationScore: 320,
    });
    expect(occupations.find((occupation) => occupation.name === 'CEO')).toMatchObject({
      jobTier: 6,
      baseWage: 1411,
    });
  });
});
```

- [ ] **Step 2: Run content test to verify it fails**

Run:

```bash
pnpm --filter @aivilization/content test
```

Expected: FAIL because content modules do not exist.

- [ ] **Step 3: Add commodity and recipe config**

Create `packages/content/src/commodities.ts`:

```ts
export type CommodityTier =
  | 'Primary'
  | 'SecondaryProcessedFood'
  | 'SecondaryRefiningMaterial'
  | 'TertiaryHighTech'
  | 'SpecialReward';

export type CommodityConfig = {
  readonly name: string;
  readonly tier: CommodityTier;
  readonly minResidentialTier: number | null;
  readonly role: string;
  readonly source: string;
};

export type ProductionRecipe = {
  readonly output: string;
  readonly inputs: Readonly<Record<string, number>>;
  readonly energyCost: number;
  readonly satietyCost: number;
  readonly timeCostSeconds: number;
  readonly rewardProbabilityPercent: number;
  readonly source: string;
};

const appendixSource = 'AIvilization v0 Appendix B Tables 7 and 9';

export const commodities = [
  { name: 'Apple', tier: 'Primary', minResidentialTier: 1, role: 'Food processing input / Basic consumption good', source: appendixSource },
  { name: 'Wheat', tier: 'Primary', minResidentialTier: 1, role: 'Food processing input / Basic consumption good', source: appendixSource },
  { name: 'Rice', tier: 'Primary', minResidentialTier: 1, role: 'Food processing input / Basic consumption good', source: appendixSource },
  { name: 'Wood', tier: 'Primary', minResidentialTier: 1, role: 'Industrial raw material', source: appendixSource },
  { name: 'Book', tier: 'Primary', minResidentialTier: 1, role: 'Basic consumption good', source: appendixSource },
  { name: 'Copper Ore', tier: 'Primary', minResidentialTier: 1, role: 'Industrial raw material', source: appendixSource },
  { name: 'Iron Ore', tier: 'Primary', minResidentialTier: 1, role: 'Industrial raw material', source: appendixSource },
  { name: 'Silicon Ore', tier: 'Primary', minResidentialTier: 1, role: 'Industrial raw material', source: appendixSource },
  { name: 'Beef', tier: 'SecondaryProcessedFood', minResidentialTier: 2, role: 'Food processing input / Secondary consumption good', source: appendixSource },
  { name: 'Chicken', tier: 'SecondaryProcessedFood', minResidentialTier: 2, role: 'Food processing input / Secondary consumption good', source: appendixSource },
  { name: 'Fish', tier: 'SecondaryProcessedFood', minResidentialTier: 3, role: 'Food processing input / Secondary consumption good', source: appendixSource },
  { name: 'Flour', tier: 'SecondaryProcessedFood', minResidentialTier: 3, role: 'Food processing input / Secondary consumption good', source: appendixSource },
  { name: 'Bread', tier: 'SecondaryProcessedFood', minResidentialTier: 3, role: 'Secondary consumption good', source: appendixSource },
  { name: 'Sushi', tier: 'SecondaryProcessedFood', minResidentialTier: 3, role: 'Secondary consumption good', source: appendixSource },
  { name: 'Apple Pie', tier: 'SecondaryProcessedFood', minResidentialTier: 3, role: 'Secondary consumption good', source: appendixSource },
  { name: 'Chicken Salad', tier: 'SecondaryProcessedFood', minResidentialTier: 3, role: 'Secondary consumption good', source: appendixSource },
  { name: 'Beef Rice', tier: 'SecondaryProcessedFood', minResidentialTier: 3, role: 'Secondary consumption good', source: appendixSource },
  { name: 'Coal', tier: 'SecondaryRefiningMaterial', minResidentialTier: 4, role: 'Industrial intermediate', source: appendixSource },
  { name: 'Copper Ingot', tier: 'SecondaryRefiningMaterial', minResidentialTier: 4, role: 'Industrial intermediate', source: appendixSource },
  { name: 'Iron Ingot', tier: 'SecondaryRefiningMaterial', minResidentialTier: 4, role: 'Industrial intermediate', source: appendixSource },
  { name: 'Pure Silicon', tier: 'SecondaryRefiningMaterial', minResidentialTier: 4, role: 'Industrial intermediate', source: appendixSource },
  { name: 'Transistor', tier: 'TertiaryHighTech', minResidentialTier: 5, role: 'High-tech intermediate', source: appendixSource },
  { name: 'Circuit Board', tier: 'TertiaryHighTech', minResidentialTier: 5, role: 'High-tech intermediate', source: appendixSource },
  { name: 'Chip', tier: 'TertiaryHighTech', minResidentialTier: 5, role: 'High-tech consumption goods', source: appendixSource },
  { name: 'Gold Apple', tier: 'SpecialReward', minResidentialTier: null, role: 'Rare reward item, not a regular production target', source: appendixSource },
] as const satisfies readonly CommodityConfig[];

export const productionRecipes = [
  { output: 'Apple', inputs: {}, energyCost: 2, satietyCost: 0, timeCostSeconds: 0.1, rewardProbabilityPercent: 0, source: appendixSource },
  { output: 'Book', inputs: { Wood: 1 }, energyCost: 32, satietyCost: 8, timeCostSeconds: 1.6, rewardProbabilityPercent: 0, source: appendixSource },
  { output: 'Copper Ingot', inputs: { Wood: 1, 'Copper Ore': 1 }, energyCost: 48, satietyCost: 12, timeCostSeconds: 2.4, rewardProbabilityPercent: 0, source: appendixSource },
  { output: 'Iron Ingot', inputs: { 'Iron Ore': 1, Coal: 1 }, energyCost: 52, satietyCost: 13, timeCostSeconds: 2.6, rewardProbabilityPercent: 0, source: appendixSource },
  { output: 'Pure Silicon', inputs: { 'Silicon Ore': 1, Coal: 1 }, energyCost: 56, satietyCost: 14, timeCostSeconds: 2.8, rewardProbabilityPercent: 0, source: appendixSource },
  { output: 'Transistor', inputs: { 'Copper Ingot': 1, 'Iron Ingot': 1 }, energyCost: 60, satietyCost: 15, timeCostSeconds: 3, rewardProbabilityPercent: 1, source: appendixSource },
  { output: 'Circuit Board', inputs: { 'Copper Ingot': 1, 'Pure Silicon': 1 }, energyCost: 80, satietyCost: 20, timeCostSeconds: 4, rewardProbabilityPercent: 2, source: appendixSource },
  { output: 'Chip', inputs: { Transistor: 1, 'Circuit Board': 1 }, energyCost: 100, satietyCost: 25, timeCostSeconds: 5, rewardProbabilityPercent: 5, source: appendixSource },
] as const satisfies readonly ProductionRecipe[];
```

- [ ] **Step 4: Add activities config**

Create `packages/content/src/activities.ts`:

```ts
export type ActivityType =
  | 'ReceiveEducation'
  | 'RecoverHealth'
  | 'RecoverEnergy'
  | 'RecoverSatiety'
  | 'Work'
  | 'Produce'
  | 'Trade';

export type ActivityConfig = {
  readonly type: ActivityType;
  readonly names: readonly string[];
  readonly source: string;
};

const appendixSource = 'AIvilization v0 Appendix B Table 8';

export const activities = [
  { type: 'ReceiveEducation', names: ['paid learning', 'reading', 'self study'], source: appendixSource },
  { type: 'RecoverHealth', names: ['see doctor'], source: appendixSource },
  { type: 'RecoverEnergy', names: ['sleep'], source: appendixSource },
  { type: 'RecoverSatiety', names: ['eat'], source: appendixSource },
  { type: 'Work', names: ['work'], source: appendixSource },
  { type: 'Produce', names: ['craft'], source: appendixSource },
  { type: 'Trade', names: ['buy', 'sell'], source: appendixSource },
] as const satisfies readonly ActivityConfig[];
```

- [ ] **Step 5: Add job and occupation config**

Create `packages/content/src/jobs.ts`:

```ts
export type WageType = 'static' | 'dynamic';

export type JobTierConfig = {
  readonly tier: number;
  readonly tierName: string;
  readonly minResidentialTier: number;
  readonly minEducationScore: number;
  readonly prerequisiteCommodity: string | null;
  readonly wageType: WageType;
  readonly source: string;
};

export type OccupationConfig = {
  readonly name: string;
  readonly jobTier: number;
  readonly minResidentialTier: number;
  readonly educationFloor: number;
  readonly eligibilityShare: number;
  readonly baseWage: number;
  readonly source: string;
};

const appendixSource = 'AIvilization v0 Appendix B Tables 10 and 11';

export const jobTiers = [
  { tier: 1, tierName: 'Entry', minResidentialTier: 1, minEducationScore: 0, prerequisiteCommodity: null, wageType: 'static', source: appendixSource },
  { tier: 2, tierName: 'Skilled', minResidentialTier: 2, minEducationScore: 20, prerequisiteCommodity: 'Beef', wageType: 'static', source: appendixSource },
  { tier: 3, tierName: 'Backbone', minResidentialTier: 3, minEducationScore: 70, prerequisiteCommodity: 'Sushi', wageType: 'static', source: appendixSource },
  { tier: 4, tierName: 'Expert', minResidentialTier: 4, minEducationScore: 110, prerequisiteCommodity: 'Pure Silicon', wageType: 'dynamic', source: appendixSource },
  { tier: 5, tierName: 'Management', minResidentialTier: 5, minEducationScore: 180, prerequisiteCommodity: 'Transistor', wageType: 'dynamic', source: appendixSource },
  { tier: 6, tierName: 'Leadership', minResidentialTier: 6, minEducationScore: 320, prerequisiteCommodity: 'Circuit Board', wageType: 'dynamic', source: appendixSource },
] as const satisfies readonly JobTierConfig[];

export const occupations = [
  { name: 'Cleaner', jobTier: 1, minResidentialTier: 1, educationFloor: 0, eligibilityShare: 1.0, baseWage: 250, source: appendixSource },
  { name: 'Waiter', jobTier: 1, minResidentialTier: 1, educationFloor: 13, eligibilityShare: 0.9, baseWage: 253, source: appendixSource },
  { name: 'Stock Clerk', jobTier: 2, minResidentialTier: 2, educationFloor: 0, eligibilityShare: 0.832, baseWage: 260, source: appendixSource },
  { name: 'Teacher', jobTier: 4, minResidentialTier: 4, educationFloor: 176, eligibilityShare: 0.32, baseWage: 380, source: appendixSource },
  { name: 'Doctor', jobTier: 5, minResidentialTier: 5, educationFloor: 207, eligibilityShare: 0.28, baseWage: 429, source: appendixSource },
  { name: 'Principal', jobTier: 6, minResidentialTier: 6, educationFloor: 357, eligibilityShare: 0.15, baseWage: 734, source: appendixSource },
  { name: 'Hospital Director', jobTier: 6, minResidentialTier: 6, educationFloor: 421, eligibilityShare: 0.12, baseWage: 961, source: appendixSource },
  { name: 'CEO', jobTier: 6, minResidentialTier: 6, educationFloor: 604, eligibilityShare: 0.065, baseWage: 1411, source: appendixSource },
] as const satisfies readonly OccupationConfig[];
```

- [ ] **Step 6: Export content package**

Create `packages/content/src/index.ts`:

```ts
export * from './activities';
export * from './commodities';
export * from './jobs';
```

- [ ] **Step 7: Run content tests and typecheck**

Run:

```bash
pnpm --filter @aivilization/content test
pnpm --filter @aivilization/content typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit content contracts**

Run:

```bash
git add packages/content
git commit -m "feat: add source-derived content contracts"
```

## Task 5: Observability Trace Contract

**Files:**
- Create: `packages/observability/src/agentCycleTrace.ts`
- Create: `packages/observability/src/index.ts`
- Create: `packages/observability/src/agentCycleTrace.test.ts`

- [ ] **Step 1: Write failing trace contract test**

Create `packages/observability/src/agentCycleTrace.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { createAgentCycleTrace } from './index';

describe('createAgentCycleTrace', () => {
  test('captures planner, simulator, command, and memory evidence in one record', () => {
    const trace = createAgentCycleTrace({
      traceId: 'trace-1',
      simulationId: 'sim-1',
      agentId: 'agent-1',
      cycleStartedAt: 100,
      observedStateSummary: 'energy=450 satiety=290 health=500 balance=191696904',
      selectedBranch: 'production-resource-management',
      candidateActions: ['craft Transistor 1', 'buy Fish 1'],
      simulatorResult: { status: 'repaired', reason: 'missing Iron Ingot, buy first' },
      emittedCommandIds: ['cmd-1', 'cmd-2'],
      memoryWriteIds: ['stm-1'],
    });

    expect(trace.selectedBranch).toBe('production-resource-management');
    expect(trace.simulatorResult.status).toBe('repaired');
    expect(trace.emittedCommandIds).toEqual(['cmd-1', 'cmd-2']);
  });
});
```

- [ ] **Step 2: Run trace test to verify it fails**

Run:

```bash
pnpm --filter @aivilization/observability test
```

Expected: FAIL because trace modules do not exist.

- [ ] **Step 3: Implement agent cycle trace contract**

Create `packages/observability/src/agentCycleTrace.ts`:

```ts
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
```

- [ ] **Step 4: Export observability package**

Create `packages/observability/src/index.ts`:

```ts
export * from './agentCycleTrace';
```

- [ ] **Step 5: Run observability tests and typecheck**

Run:

```bash
pnpm --filter @aivilization/observability test
pnpm --filter @aivilization/observability typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit observability contracts**

Run:

```bash
git add packages/observability
git commit -m "feat: add agent cycle trace contract"
```

## Task 6: App Shells

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/src/index.ts`
- Create: `apps/worker/package.json`
- Create: `apps/worker/tsconfig.json`
- Create: `apps/worker/src/index.ts`
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/src/index.ts`

- [ ] **Step 1: Create app package manifests**

Create `apps/api/package.json`:

```json
{
  "name": "@aivilization/api",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "build": "tsup src/index.ts --format esm",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@aivilization/sim-core": "workspace:*",
    "@aivilization/observability": "workspace:*"
  }
}
```

Create `apps/worker/package.json`:

```json
{
  "name": "@aivilization/worker",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "build": "tsup src/index.ts --format esm",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@aivilization/agent-runtime": "workspace:*",
    "@aivilization/content": "workspace:*",
    "@aivilization/observability": "workspace:*",
    "@aivilization/sim-core": "workspace:*"
  }
}
```

Create `apps/web/package.json`:

```json
{
  "name": "@aivilization/web",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "build": "tsup src/index.ts --format esm",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@aivilization/content": "workspace:*",
    "@aivilization/observability": "workspace:*",
    "@aivilization/sim-core": "workspace:*"
  }
}
```

- [ ] **Step 2: Create app TypeScript configs**

For each app, create `tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create app entrypoints**

Create `apps/api/src/index.ts`:

```ts
import type { CommandEnvelope } from '@aivilization/sim-core';

export type ApiCommandSubmission = {
  readonly command: CommandEnvelope;
  readonly accepted: boolean;
};
```

Create `apps/worker/src/index.ts`:

```ts
import type { AgentRuntimeModuleStatus } from '@aivilization/agent-runtime';
import type { CommodityConfig } from '@aivilization/content';

export type WorkerBootContract = {
  readonly agentRuntime: AgentRuntimeModuleStatus;
  readonly commodityCount: number;
  readonly commoditySample?: CommodityConfig;
};
```

Create `apps/web/src/index.ts`:

```ts
import type { AgentCycleTrace } from '@aivilization/observability';

export type WebInspectionPanelContract = {
  readonly selectedTrace?: AgentCycleTrace;
  readonly showsPlannerInternals: true;
};
```

- [ ] **Step 4: Run workspace typecheck**

Run:

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit app shells**

Run:

```bash
git add apps
git commit -m "chore: add app shells"
```

## Task 7: Whole-Workspace Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document development commands**

Add this section to `README.md` after `## Current State`:

````md
## Development

Install dependencies:

```sh
corepack enable
pnpm install
```

Run all checks:

```sh
pnpm check
```

Build all packages and apps:

```sh
pnpm build
```
````

- [ ] **Step 2: Run full verification**

Run:

```bash
pnpm format
pnpm check
pnpm build
git status --short
```

Expected:

- `pnpm format` completes and may update formatting.
- `pnpm check` passes.
- `pnpm build` passes.
- `git status --short` shows only intended README or formatting changes.

- [ ] **Step 3: Commit verification docs**

Run:

```bash
git add README.md package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json .prettierrc.json eslint.config.js vitest.workspace.ts apps packages
git commit -m "docs: document workspace verification"
```

If there are no changes after formatting and documentation, run:

```bash
git status --short
```

Expected: clean working tree.

## Self-Review

- Spec coverage: This plan covers Phase 1 architecture skeleton, package boundaries,
  server-authoritative command/event primitives, partitioned streams, command idempotency,
  snapshot/replay checkpoints, source-derived content anchors, observability trace shape, app
  shells, and workspace verification. Full AIvilization systems remain covered by later
  implementation phases in the design spec.
- Red-flag scan: No forbidden marker strings remain in the plan.
- Type consistency: Package names, exported type names, and import paths are consistent across
  tasks.
