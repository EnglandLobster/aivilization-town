# Local Runtime Manifest Bootstrap Host Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manifest-driven local runtime host that bootstraps every declared simulation partition before exposing the registry.

**Architecture:** Keep manifest parsing pure and reusable, then add a worker-owned host orchestration seam that initializes durable storage, profile seeds, baseline checkpoints, and registry routing from the same manifest. The host remains framework-agnostic so future API servers, CLI tools, background workers, and Godot gateways can share one startup contract.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, file-backed local runtime storage.

---

## Scope

This slice adds a local runtime host function for manifest-based startup.

It does not add HTTP routes, Godot protocol adapters, distributed leases, multi-process scheduling, or a new scenario content format.

## File Structure

- Modify `apps/worker/src/localSimulationRuntimeManifest.ts`: expose a resolved partition catalog so bootstrap and registry creation share the same validation and preset lookup.
- Create `apps/worker/src/localSimulationRuntimeHost.ts`: orchestrate per-partition scenario bootstrap and registry creation from one manifest.
- Create `apps/worker/src/localSimulationRuntimeHost.test.ts`: verify durable bootstrap, profile seeding, restart idempotence, and registry usability.
- Modify `apps/worker/src/index.ts`: export the host API.
- Create `docs/superpowers/plans/2026-06-24-local-runtime-manifest-bootstrap-host-slice.md`: track this implementation slice.

## Tasks

### Task 1: Failing Host Tests

**Files:**

- Create: `apps/worker/src/localSimulationRuntimeHost.test.ts`
- Modify: `apps/worker/src/localSimulationRuntimeManifest.ts`

- [x] **Step 1: Write failing tests**

Add tests proving:

- `bootstrapLocalSimulationRuntimeHostFromManifest` bootstraps every manifest partition.
- Each partition gets an initialized checkpoint on first startup.
- Scenario long-term profiles are seeded in each partition storage.
- The returned registry can query projections and route lifecycle operations.
- A restart reuses existing checkpoints while keeping registry routing valid.

- [x] **Step 2: Verify red**

Run:

```bash
pnpm --filter @aivilization/worker test -- localSimulationRuntimeHost.test.ts
```

Expected: FAIL because `bootstrapLocalSimulationRuntimeHostFromManifest` is not exported yet.

### Task 2: Manifest Resolution And Host Implementation

**Files:**

- Modify: `apps/worker/src/localSimulationRuntimeManifest.ts`
- Create: `apps/worker/src/localSimulationRuntimeHost.ts`
- Modify: `apps/worker/src/index.ts`

- [x] **Step 1: Expose resolved manifest partition catalog**

Add a reusable resolver that validates manifest defaults, validates partition identities, resolves scenario presets, computes effective tick/runtime values, and returns resolved partitions.

- [x] **Step 2: Implement host bootstrap**

Add `bootstrapLocalSimulationRuntimeHostFromManifest` that:

- resolves manifest partitions once;
- calls `bootstrapLocalScenarioRuntime` for every partition with its scenario preset, market pools, money supply, and `bootstrappedAt`;
- creates a `LocalSimulationBackendRegistry` from the manifest input;
- returns `manifestId`, `registry`, and per-partition bootstrap summaries.

- [x] **Step 3: Verify green**

Run:

```bash
pnpm --filter @aivilization/worker test -- localSimulationRuntimeHost.test.ts localSimulationRuntimeManifest.test.ts localScenarioBootstrap.test.ts
```

Expected: PASS.

### Task 3: Verification And Commit

**Files:**

- All files touched in this plan.

- [x] **Step 1: Run full verification**

Run:

```bash
pnpm check
pnpm build
git diff --check
```

Expected: all commands pass.

- [x] **Step 2: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-06-24-local-runtime-manifest-bootstrap-host-slice.md apps/worker/src/index.ts apps/worker/src/localSimulationRuntimeManifest.ts apps/worker/src/localSimulationRuntimeHost.ts apps/worker/src/localSimulationRuntimeHost.test.ts
git commit -m "feat: bootstrap local runtime manifests"
```

## Self-Review

- Spec coverage: Moves toward paper-scale town startup by making multi-partition runtime topology declarative, durable, and reusable.
- Boundary review: Manifest resolution stays pure; bootstrap host owns orchestration; registry/backend/runtime execution remain separate.
- Placeholder scan: No deferred implementation markers remain.
