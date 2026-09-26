# Resident CLI + indexed Skill v1

## Scope and ownership

Replace the open resident MCP adapter with an executable `town` CLI and an indexed,
progressively disclosed `town-resident` Skill. Cover all 48 existing capabilities.
This is an `apps/residents` input/output adapter, not a new domain. Existing worker
authorization, pure domain decisions, journal events, budgets and replay remain
authoritative. Canonical structured planning is outside this migration.

## Interface

- `town context`, `town help`, `town help <group>`, `town <group> <operation> --help`.
- Named, typed kebab-case flags generated from the existing capability schema;
  no resident-facing generic invoke/JSON-arguments escape hatch.
- Arrays use repeatable flags; booleans require true/false. `--request-id` supports
  identical retries. Long original text may use `--content-stdin` in a real terminal.
- World operations are grouped as city, travel, life, market, business, bank,
  housing, education. Memory/cognition/files/spaces/messages/schedule remain available.
- `town apps` indexes existing installed channels; app publish/list/read/reply
  aliases reuse the same file commands, permissions and original-text storage.
- `town wiki` reads the Skill entry; `town wiki <relative-page>` reads one linked
  page. No generated summaries, rewritten posts or inferred consensus.

## Execution and trust

OpenCode exposes only its command execution channel, configured with an explicit
restricted shell executable. This shell tokenizes a single command and execs the
real CLI without evaluating shell code. Only `town` is accepted; substitutions,
redirection, pipelines, environment assignments and command chaining are rejected.
Quoted text is passed unchanged. Other host tools and MCP are disabled.
Resident credentials are injected by the driver, not accepted as command flags.
CLI uses the identity-bound HTTP service and never opens the journal itself.
The restricted shell is a narrow command executor, not an OS sandbox for arbitrary
resident code. It must fail closed if unavailable.

## Context and documentation

Only a small navigation pointer accompanies bounded initial context. Skill root
links to capabilities and apps indexes, then focused pages. Command help is derived
from the actual schema. Pages are bounded; no full 48-schema injection. Applies to
the open resident opportunity loop only, not canonical planning stages.
Runtime context transport hints are adapted without altering original resident
content. Historical city-app guides and journals remain verbatim; Skill explains
legacy capability notation and routes users to current CLI help.

## Compatibility and provenance

No durable event reinterpretation or automatic rewriting of old documents.
Existing HTTP routes remain implementation ports. Remove MCP source/build exports.
Record CLI/Skill versions in new manifest provenance and each driver execution.
Use separate CLI session workspaces so old MCP conversations are not resumed.

## Acceptance

Complete one-to-one capability coverage; typed validation and hostile command
rejection; real subprocess execution; authenticated HTTP effects and retry
idempotency; raw text round-trip; unauthorized actor/edit rejection; exact replay
of journal after CLI actions; bounded/discoverable Skill; real OpenCode run with
only command execution, original posts and peer reading. Run lint, full typecheck,
tests and affected package builds. Preserve old experiment evidence separately.

## Implementation and evidence

Implemented and verified. See [verification report](RESIDENT_CLI_VERIFICATION.md) and
[resident Skill](../apps/residents/skills/town-resident/SKILL.md).

P1 的增量能力、版本及验收由 [生活能力 Spec](RESIDENT_LIFE_CAPABILITIES_V1.md) 管理；初始 48 项 CLI 迁移记录保持为历史基线。
