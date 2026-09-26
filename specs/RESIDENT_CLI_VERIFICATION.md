# Resident CLI / indexed Skill verification — 2026-09-25

## Delivered

- All 48 existing open resident capabilities have named CLI routes in 14 groups.
- `town context`, hierarchical `town help`, typed flags and command-level `--help`.
- `town apps` lists installed channels; publish/list/read aliases reuse existing
  document authority, preserve originals and support reply links and author tags.
- `town wiki` serves a maintained Skill with 25 pages: entry, capability index,
  execution contract, application index/guides and command references. Exported
  files live in `apps/residents/skills/town-resident`; source is `residentSkill.ts`
  plus the existing capability catalog. Builds regenerate the files without an LLM.
- OpenCode uses only its `bash` command execution tool, bound to an explicit,
  preflighted restricted shell which spawns the real CLI process without shell
  evaluation. MCP source modules/build entries/public exports have been removed.
- HTTP is retained as the internal identity-bound application port. CLI never
  directly opens world storage. The operator CLI remains separate.

## Repository gates

| Gate                                                | Result                                              |
| --------------------------------------------------- | --------------------------------------------------- |
| `pnpm lint`                                         | Passed                                              |
| `pnpm -r --sort typecheck`                          | Passed                                              |
| `pnpm test`                                         | 2158 passed, 1 skipped; 283 files passed, 1 skipped |
| `pnpm --filter @aivilization/residents... build`    | Passed                                              |
| Final `pnpm --filter @aivilization/residents build` | Passed                                              |
| `pnpm --filter @aivilization/residents verify:cli`  | Passed                                              |
| skill-creator `quick_validate.py`                   | Passed                                              |
| `git diff --check`                                  | Passed                                              |

CLI tests verify every registered route dispatches its original capability with
typed arguments, local validation, invalid booleans/numbers/duplicates, array flags,
quoted multiline originals, unknown-outcome retry keys, bounded Skill pages and
resolvable links. Real HTTP tests cover author permissions, private-space access,
revision conflicts, metadata-only indexes, movement and replay. Subprocess tests
exercise the compiled executable and configured shell, stdin, quoted metacharacters,
rejected host commands/substitution/redirection, authentication, idempotent posting
and deposits, unchanged money supply, actual travel and exact journal replay.

## Actual OpenCode execution

Separate experiment: `.local/open-residents/cli-20260925`.
OpenCode 1.18.32, model `opencode-go/deepseek-v4.1-flash`.
Mode: **explicitly prompted application/transport acceptance**, not a spontaneous
emergence experiment or a city-scale load test.

- Two residents, two completed opportunities.
- 26 command executions; every recorded native tool is `bash`, every recorded
  command starts with `town`, all command exits are zero. No MCP calls.
- Both read `town wiki` and focused application pages.
- 15 authoritative capability calls; 22 journal commits including system events.
- Two original posts, a shop idea and another resident's linked question.
- Cross-resident original reading and metadata indexing passed the existing app
  validator. Published bodies exactly match both command inputs and durable records.
- Money supply remained 250225.

Sanitized evidence: [RESIDENT_CLI_2026-09-25.json](evidence/RESIDENT_CLI_2026-09-25.json).
Raw command/provider receipts and journal are in the ignored experiment directory;
credentials are separate and are not included in the checked-in evidence.

## Compatibility and limits

No world/domain rule, event payload interpretation or accounting semantics changed.
Existing manifests and journal records are retained, and execution receipts record
the actual CLI and Skill versions. New manifests declare those versions as well.
Historical public guides may mention internal capability names; current Skill pages
explain the CLI equivalents without rewriting those original documents. CLI-owned
context/index navigation hints are adapted separately from document bodies.

The CLI driver uses a separate workspace namespace and resumes only sessions marked
with its CLI version; prior MCP conversations remain historical. The canonical
structured planning pipeline is separate from this open resident adapter migration.

The command executor supports one command with quoting. It deliberately does not
implement a general operating-system shell, pipelines or arbitrary programs. Regular
terminal use supports stdin; model execution uses quoted `--content`. The restricted
executor is not a general OS sandbox for resident-generated code. Existing text apps
still publish information/intentions; this migration adds no order/delivery/refund
mechanism and makes no tens-of-thousands-of-residents throughput claim.
