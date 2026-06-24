# Supervisor Validation Report Trace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve links from supervisor `start-all` operation traces to validation reports generated
by lifecycle hooks.

**Architecture:** Lifecycle start results may contain a full `validationReport` schedule result, but
the durable supervisor operation trace should store only report identity and bounded window metadata.
The report repository remains the source of truth for metrics and findings; operation traces become
an audit index from runtime commands to generated validation artifacts.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, local runtime supervisor and file-backed
operation traces.

---

## Scope

This slice adds:

- optional validation report metadata on successful operation trace partition entries
- run id, generated timestamp, source, stream version, event window, event count, and projection
  sequence in that metadata
- supervisor tests proving `start-all` traces retain validation report links

It does not duplicate full report metrics in operation traces, add new HTTP routes, change report
repository semantics, or add scheduler retry policy.

## Runtime Semantics

- Successful partition traces include `validationReport` only when the lifecycle result generated
  one.
- Pauses and starts without configured validation remain unchanged.
- Failed partition traces remain focused on serialized command errors.
- The report repository is still queried by `runId`; the operation trace only points to it.

## File Structure

- Modify `apps/worker/src/localSimulationRuntimeOperationTrace.ts`: add validation report trace
  metadata type.
- Modify `apps/worker/src/localSimulationRuntimeSupervisor.ts`: extract metadata from start
  lifecycle results when recording operation traces.
- Modify `apps/worker/src/localSimulationRuntimeSupervisor.test.ts`: prove durable trace linkage.

## Tasks

### Task 1: Failing Supervisor Trace Test

**Files:**

- Modify: `apps/worker/src/localSimulationRuntimeSupervisor.test.ts`

- [x] **Step 1: Bootstrap a host with validation schedule**

Configure lifecycle validation through runtime host wiring, seed deterministic trade events into
each partition, and run `supervisor.startAll`.

- [x] **Step 2: Assert operation trace report links**

Assert `getOperationTrace(traceId)` returns successful partition trace entries with
`validationReport.runId`, `generatedAt`, `source`, `fromSequence`, `toSequence`, and `eventCount`.

### Task 2: Operation Trace Metadata

**Files:**

- Modify: `apps/worker/src/localSimulationRuntimeOperationTrace.ts`
- Modify: `apps/worker/src/localSimulationRuntimeSupervisor.ts`

- [x] **Step 1: Add metadata type**

Add a bounded operation-trace metadata shape for generated validation reports.

- [x] **Step 2: Extract metadata while recording traces**

When a successful partition result carries `validationReport`, store only metadata on the operation
trace partition entry.

### Task 3: Verification And Commit

**Files:**

- All files touched in this plan.

- [x] **Step 1: Run targeted verification**

Run:

```bash
pnpm --filter @aivilization/worker test -- localSimulationRuntimeSupervisor.test.ts
```

- [x] **Step 2: Run package verification**

Run:

```bash
pnpm --filter @aivilization/worker typecheck
pnpm --filter @aivilization/worker test
git diff --check
```

- [x] **Step 3: Commit**

Commit with:

```bash
git commit -m "feat: link supervisor traces to validation reports"
```

## Self-Review

- Boundary review: operation trace stores report pointers; repository stores report content.
- Data-flow review: lifecycle validation result -> supervisor command result -> durable trace index.
- Extension review: HTTP/Godot control panels can link command history to validation reports without
  scanning every partition repository.
