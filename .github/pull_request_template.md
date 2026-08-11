## Summary

<!-- What changed and why. One concern per PR. -->

## Evidence class

<!-- mechanism verification / pipeline verification / empirical reproduction /
     scale validation — see docs/PAPER_ALIGNMENT_MATRIX.md. Do not claim a
     higher class than the PR establishes. -->

## Canonical-path boundary

- [ ] Default configuration behavior is unchanged, OR this change is behind an explicit opt-in flag
- [ ] If this touches an evidence run path, the active flag set is declared

## Invariants

- [ ] `pnpm check` passes locally (lint + typecheck + test)
- [ ] World state transitions are deterministic, replayable, and idempotent
- [ ] LLM outputs (if any) are recorded proposals; authoritative adjudication stays deterministic
- [ ] Durable payloads/events are append-compatible (new fields are optional)
- [ ] No new third-party dependencies (or discussed in a linked issue)
