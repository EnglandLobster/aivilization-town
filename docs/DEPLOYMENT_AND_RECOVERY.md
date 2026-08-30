# Deployment, Recovery, and Data Compatibility

This document defines the supported single-node deployment and recovery contract for the canonical
AIvilization town runtime. It does not claim the paper's public, tens-of-thousands-agent deployment;
that scale boundary remains tracked by `SCALE-002`.

`participant-access-control-v2` provides built-in Bearer authentication, explicit versioned consent,
durable human-command attribution, participant ownership ACLs, per-participant Agent quotas, durable
per-principal mutation rate limits, and an operator role for runtime mutations. Public reads remain open.
Open mutation mode is accepted only on a loopback bind; startup fails closed when an unauthenticated
configuration selects a non-loopback host. TLS termination remains an external deployment
responsibility. Do not expose the service or transmit Bearer credentials over plaintext public
transport.

## Release and deployment path

The supported release unit is a pinned repository revision with a frozen pnpm lockfile, a successful
full check, built workspace artifacts, a persistent runtime root, and a secret environment file outside
the repository.

1. On the build host, check out the exact revision and run:

   ```bash
   corepack enable
   pnpm install --frozen-lockfile
   pnpm check
   pnpm build
   ```

2. Provision at least the reference 4-vCPU/4-GiB node class, a dedicated 25-GiB durable volume or
   enforced quota, a dedicated service account, `/opt/aivilization-town` for the release, and
   `/var/lib/aivilization-town` for durable state. The service account must be the only writer to the
   state root.
3. Copy [`runtime.env.example`](../deploy/systemd/runtime.env.example) to
   `/etc/aivilization-town/runtime.env`, set mode `0600`, and replace every placeholder. Provider mode
   requires endpoint, model, API key when applicable, and explicit input/output token prices. Zero
   prices are valid only when the provider is genuinely free; they must not be used to hide unknown
   cost. For any non-loopback or participant-facing deployment, enable authenticated access and
   provision distinct participant and operator credentials. The environment file contains the raw
   bootstrap tokens and must remain mode `0600`; the parsed runtime configuration and resolved
   manifest retain only SHA-256 digests and non-secret policy metadata.
4. Adapt [`aivilization-town.service.example`](../deploy/systemd/aivilization-town.service.example) to
   the host's absolute `pnpm` path and directories, install it as a systemd unit, then start it. The
   example limits the service to four CPU cores and 3 GiB of memory, retaining 25% of node memory for
   the OS and sidecars. The process receives SIGTERM for graceful queue/scheduler/recovery shutdown and
   is restarted only on failure.
5. Keep the service bound to `127.0.0.1` unless authenticated mode, TLS termination, a private-network
   threat model, credential rotation, and upstream abuse controls are explicitly in place.

## Participant authentication and ownership boundary

Authenticated mode requires `AIVILIZATION_ACCESS_MODE=authenticated` and exactly one identity mode:

- Small controlled deployments may provide a non-empty `AIVILIZATION_ACCESS_CREDENTIALS_JSON`
  array. Each credential has a unique `keyId`, stable `subjectId`, secret token of at least 32
  characters, and one or more `participant`/`operator` roles. At least one credential for each role is
  required. Rotate a credential by changing its key/token in the protected environment and restarting
  the process.
- Participant-facing deployments should configure `oidc-jwks-authentication-v1` with
  `AIVILIZATION_OIDC_ISSUER`, `AIVILIZATION_OIDC_AUDIENCE`, and `AIVILIZATION_OIDC_JWKS_URL` instead
  of static credentials. Optional settings select the role claim, participant/operator claim values,
  asymmetric algorithms, and clock tolerance; see `deploy/systemd/runtime.env.example`.

OIDC mode validates the signature through the provider's HTTPS JWKS, exact issuer and audience,
standard `sub` and `exp` claims, an explicit asymmetric algorithm allowlist, and configured role
mapping. The JWKS resolver caches keys in memory and refreshes them for provider key rotation. Invalid,
expired, wrong-audience, wrong-issuer, unsupported-role, and unverifiable tokens all fail closed. Raw
tokens and JWK material are never written to runtime state or the resolved manifest; the manifest
contains only the non-secret issuer/audience/JWKS URL and verification policy. Account recovery,
credential revocation, MFA, and deletion of the upstream account remain the identity provider's
responsibility and must be exercised in the deployment drill.

The boundary is intentionally layered:

- the Node adapter validates Bearer credentials through a replaceable authenticator and injects a
  normalized principal into the transport-neutral API request;
- `participant-access-control-v2` makes reads public, binds participant Agent creation to the subject,
  permits steering only for the registered owner or an operator, and requires the operator role for
  lifecycle, replay, scheduler, queue, recovery, and other runtime mutations;
- the API performs an early ownership/quota check, but `runtime-agent-registration-v3` repeats the
  quota check against authoritative replayed world state before emitting `AgentRegistered`, closing
  concurrent or queued-request races;
- manifest-seeded Agents have no participant owner and are steerable only by an operator in
  authenticated mode;
- raw access tokens and credential digests never enter events, command payloads, snapshots, traces, or the
  resolved run manifest. The manifest records the policy, quota, authentication mechanism, and
  credential count only.

The built-in static Bearer verifier is appropriate behind a controlled TLS edge for a small
self-hosted deployment. OIDC/JWKS is the supported external identity boundary and remains outside world
and agent-domain packages. The local runtime provides durable mutation rate limits; credential
provisioning UI, account recovery, edge-wide abuse prevention, and identity-provider lifecycle remain
deployment responsibilities and must be demonstrated before claiming an Internet-scale service.

## Participant data deletion boundary

`participant-data-deletion-v1` provides an offline, copy-on-write deletion executor for direct
participant identity. It does not delete social history or silently create gaps in the event stream.
Instead it irreversibly replaces the selected `subjectId` with a random tombstone across authoritative
events, projections, command/trace JSON, and other runtime JSON; rebuilds the compact event idempotency
index against the rewritten events; scans JSON, gzip, and length-prefixed deflate payloads for residual
references; and fails closed if any unsupported identity-bearing payload remains. Sequence numbers and
anonymous research history are preserved.

The source runtime must be stopped. Put the subject ID in a mode-`0600` file so it does not appear in
the shell history or process list, then run:

```bash
pnpm --filter @aivilization/server delete-participant-data -- \
  --source-root-dir /var/lib/aivilization-town \
  --target-root-dir /var/lib/aivilization-town.anonymized \
  --subject-id-file /run/aivilization-delete/subject-id \
  --confirm-source-stopped
```

The command fingerprints the source tree before and after copying and deletes an incomplete target if
the source changed. A successful target contains `participant-data-deletion.json`, no direct source
subject reference, and replay-safe event idempotency records. Activation is deliberately separate:
validate and back up the source, point the service at the target root, start it, verify replay/health,
then retire the source and backup according to the deployment's approved retention schedule. Merely
creating the target is not a completed deletion request because the old root still exists.

`participant-data-lifecycle-v1` makes that surrounding workflow executable. The deployment chooses
positive direct-identity and backup retention durations; the paper does not define them. The audit
ledger stores only an HMAC-SHA256 subject reference, freezes every identity-bearing copy's path and
tree fingerprint, and hashes every event into an append-only chain. Keep its random 32-byte audit key
outside the runtime and backup roots in a mode-`0600` file. With the runtime and registered backup
writers stopped, record the request before creating the anonymized copy:

```bash
pnpm --filter @aivilization/server participant-data-lifecycle -- request \
  --audit-root-dir /var/lib/aivilization-deletion-audit \
  --subject-id-file /run/aivilization-delete/subject-id \
  --audit-key-file /run/aivilization-delete/audit-hmac-key.base64 \
  --source-root-dir /var/lib/aivilization-town \
  --backup-root-dir /srv/aivilization-backups/pre-delete \
  --direct-retention-days 7 \
  --backup-retention-days 30 \
  --confirm-copy-writers-stopped
```

After `delete-participant-data` succeeds, attach its target to the returned request ID:

```bash
pnpm --filter @aivilization/server participant-data-lifecycle -- prepare \
  --audit-root-dir /var/lib/aivilization-deletion-audit \
  --request-id participant-deletion-request:... \
  --target-root-dir /var/lib/aivilization-town.anonymized
```

Switch the deployment root, restart, verify the resolved manifest and healthy replay, then explicitly
record activation:

```bash
pnpm --filter @aivilization/server participant-data-lifecycle -- activate \
  --audit-root-dir /var/lib/aivilization-deletion-audit \
  --request-id participant-deletion-request:... \
  --target-root-dir /var/lib/aivilization-town.anonymized \
  --resolved-run-manifest-id resolved-run-manifest:sha256:... \
  --confirm-activated-and-healthy
```

A scheduled offline job may now enforce deadlines. `retire-due` refuses to delete before activation or
before a copy's deadline, refuses a copy whose fingerprint changed, records retirement intent before
deletion for crash recovery, and never touches the active anonymized target or audit root:

```bash
pnpm --filter @aivilization/server participant-data-lifecycle -- retire-due \
  --audit-root-dir /var/lib/aivilization-deletion-audit \
  --request-id participant-deletion-request:... \
  --confirm-copy-writers-stopped \
  --confirm-irreversible-retirement
```

The request becomes `completed` only after every registered source/backup copy is absent and its
retirement completion is durably chained. This closes the repository's local deletion request,
retention and backup-expiry mechanism. A public privacy program still needs approved jurisdictional
durations, independent audit-key custody, external identity-provider deletion/recovery, and a live TLS
drill before participant recruitment.

Validate the release through the canonical endpoint:

```bash
curl --fail --silent http://127.0.0.1:3000/runtime/daemon/status | jq '{health, productionSlo}'
```

Promotion requires HTTP 200, overall `health` not equal to `attention`, the expected resolved-run
manifest ID/source revision, and no failed production SLO checks. For a dirty or unpackaged release,
the source revision is incomplete unless it includes the exact `git-workspace-fingerprint-v1` digest;
packaged metadata must provide `AIVILIZATION_SOURCE_WORKSPACE_SHA256` and
`AIVILIZATION_SOURCE_WORKSPACE_PATH_COUNT` together. A deterministic LLM N/A result is
acceptable only for an explicitly non-provider deployment.

## Reference resource envelope

The paper reports a public deployment with tens of thousands of agents and identifies the cost of
thousands of concurrent memory-augmented agents as a remaining bottleneck, but it publishes no CPU,
memory, disk, retention, or leak threshold. `runtime-resource-envelope-v2` is therefore explicitly a
repository design decision rather than a paper-derived constant.

The reference class is one backend process on four logical CPUs and a 4-GiB node with a 25-GiB durable
volume. The runtime receives 3 GiB of memory and 18.75 GiB of durable-data budget after reserving 25%
of each capacity. A canonical matrix assessment requires the exact 25/100/1,000-agent artifacts from
one identical commit and workspace fingerprint, at least 30 samples from the final third of each run,
and checks:

- source-artifact eligibility and sufficient observation-host capacity;
- measured peak RSS against the runtime memory budget;
- final RSS and heap projected one additional hour using only a positive least-squares final-third
  slope, while retaining observed peak RSS as an independent hard gate so warm-up is excluded without
  hiding a real capacity breach;
- final durable bytes projected one additional day using the greater of the all-window average growth
  rate and final-third least-squares slope.

Regrade immutable artifacts with:

```bash
pnpm regrade:runtime-resource-envelope -- \
  --artifact-root-dir /srv/aivilization-soak-artifacts \
  --source-artifact-id runtime-soak-evidence:sha256:<smoke-25-hash> \
  --source-artifact-id runtime-soak-evidence:sha256:<default-100-hash> \
  --source-artifact-id runtime-soak-evidence:sha256:<headless-stress-1000-hash>
```

The command writes a separate content-addressed assessment and never mutates source observations.
Passing means the observed deterministic single-process backend matrix fits this reference allocation.
Because the current artifacts were not produced under enforced cgroup limits, passing does not prove
limit-constrained behavior, Provider capacity, the paper's public deployment, or million-agent scale.

## Simulated activity-time compatibility

The canonical manifest records `exclusive-agent-activity-time-v2`. Its default world policy assigns a
successful trade 300 simulated seconds, skips scheduling while an Agent is busy, and delays completion
of a finished objective until availability. The duration is a repository-defined consistency policy,
not a value reported by the paper. Readers accept persisted `exclusive-agent-activity-time-v1` events
so existing roots remain replayable after upgrade; new canonical runs write v2 semantics. Do not compare
throughput or storage evidence across v1 and v2 as if only the executable changed: the action-capacity
policy changed, so each evidence matrix must use one exact source fingerprint and one resolved manifest.

## Backup and restore boundary

All event streams, projection snapshots/checkpoints, run sessions, queue state, traces, manifests, and
experiment artifacts live beneath the configured root. A filesystem copy is consistent only while the
service is stopped; copying the append-only files while writers are active is not a supported backup.

The event stream is the replayable source of truth. `local-projection-snapshot-retention-v1` keeps the
latest two full projection snapshots per simulation partition: the newly written candidate and the
snapshot referenced by the current checkpoint. This ordering keeps recovery valid if the process exits
between snapshot creation and checkpoint promotion, while preventing every intermediate checkpoint
from becoming a permanent full-projection file. Historical state must be reconstructed from the event
stream; rolling snapshots are recovery accelerators, not a historical archive. The resolved run
manifest records the retention count and rule.

For every release or migration:

1. Gracefully stop the service and verify the process has exited.
2. Create a new timestamped copy or storage snapshot of the entire root. Never overwrite the previous
   backup and never run a drill against the live root.
3. Restore that backup into a new path owned by the service account.
4. Run the automated drill against the restored, non-production copy.
5. Preserve the generated JSON artifact with the release record.

The safe default drill creates and preserves its own temporary durable root:

```bash
pnpm drill:runtime-recovery
```

To exercise a dedicated recovery-drill root or restored drill copy, the explicit safety acknowledgement
is mandatory:

```bash
pnpm --filter @aivilization/server recovery-drill -- \
  --root-dir /srv/recovery-copies/aivilization-drill-20260720 \
  --confirm-non-production-copy
```

The drill uses the 25-agent headless recovery profile and performs real file-backed operations:

- runs a cycle and records the projection checkpoint, snapshot URI, projection hash, sequence, and
  simulation clock;
- tears down the first object graph, bootstraps a second graph from the same root, and requires the
  restored checkpoint and projection hash to match exactly;
- runs another cycle and requires both event sequence and simulation clock to advance;
- deliberately leases and dead-letters one queue job, invokes the canonical recovery host, and requires
  the same recovery pass to replay and complete it with one replay and two preserved attempts;
- writes an immutable, content-addressed `local-runtime-recovery-drill-v1` JSON artifact under
  `operations/recovery-drills/`.

The injected failure is safe only on a non-production copy. The CLI rejects an explicit root without
`--confirm-non-production-copy`.

## Version-compatible data migration policy

`local-runtime-data-compatibility-v2` is embedded in every resolved run manifest and registered at the
root as `runtime-data-compatibility.json` after the canonical runtime successfully bootstraps. The
current readable and writable data-layout set is exactly `{2}`. A new binary does not write a v1 root,
and an old binary must never write a v2 root: compact idempotency records are core duplicate-suppression
state, not an optional observability extension.

The compatibility rules are fail-closed:

- an unknown marker schema or future layout version rejects startup before daemon services begin;
- only a completely empty unversioned root can be initialized as v2; any non-empty unversioned root
  requires explicit operator classification and a v1 migration rather than in-place adoption;
- v1-to-v2 migration is offline and copy-on-write: stop the only writer, provide separate non-nested
  source and target paths, hash the source tree, copy it into a sibling staging directory, migrate and
  validate there, verify the source hash again, and publish with an atomic rename;
- no migration may rewrite the only copy, silently downgrade a future layout, discard JSONL history, or
  change a content-addressed manifest/artifact in place;
- rollback means stopping the new writer and pointing the service back to the untouched pre-migration
  copy with the previous compatible binary;
- each migration writes a content-addressed `local-runtime-data-migration-v1-to-v2` artifact containing
  both source hashes, the original v1 marker and revision, the migration-executor revision, per-store
  byte/record counts, projection-reference relocation counts, and rollback/publish semantics;
- a layout change requires a new marker/policy version, an explicit old-to-new migrator, fixtures for
  both versions, idempotence and corruption tests, and a release note describing reversibility and
  information loss. Until those exist, the new binary rejects the old layout rather than guessing.

After stopping and independently backing up the v1 service, migrate into a path that does not yet
exist:

```bash
pnpm migrate:runtime-data-v1-to-v2 -- \
  --source-root-dir /var/lib/aivilization-town-v1 \
  --target-root-dir /var/lib/aivilization-town-v2 \
  --confirm-source-stopped
```

The migrator validates every legacy idempotency row against the authoritative event sequence, writes
hashed sequence references as uint32-length-prefixed raw-deflate frames, relocates every checkpoint and
snapshot file URI from source to target, loads each latest checkpoint/snapshot before and after publish,
and truncates only the copied legacy idempotency files. Partial frames, incomplete JSONL tails,
duplicate keys, stream mismatches, references outside the source root, source mutation, and a non-empty
or incompatible target fail closed. Re-running against the same verified target returns the same
artifact; it does not re-migrate or rewrite it.

Agent-cycle traces are an optional observability extension inside layout 1, not authoritative world
state. `agent-cycle-trace-storage-v5` preserves every lossless trace while union-reading the v2-v4 gzip
prefix and writing each new available-agent batch as a length-prefixed Brotli-quality-6 JSONL frame in
the existing `agent-cycle-traces.jsonl.gz` compatibility path. The codec is bound by each v2 index row;
the misleading historical suffix is not used for format detection. The repository retains only the
latest 1,024 batch rows plus a fixed 16,777,216-bit Bloom filter in memory. A Bloom negative proves
absence; a possible match falls back to an exact streaming scan, so bounded heap does not introduce
false-positive data loss. Limited latest queries use the hot suffix only when it is provably complete;
all other queries filter the complete disk index and decompress only matching frames.

V5 union-reads the legacy `agent-cycle-trace-batches.jsonl` index and writes new index rows to
`agent-cycle-trace-batches.deflate` as independently checksummed, uint32-length-prefixed raw-deflate
JSON frames. The frame still contains every v1 member offset/length, trace ID, agent/time range, and
payload/index hash; compactness does not remove query or integrity metadata. Fully covered duplicate
ranges are canonicalized so a v3 rollback that recovered a compact tail into its legacy JSONL index
can be read again by v5; gaps and partial overlaps fail closed. A complete compressed data tail left
between data and index appends is decoded as either a legacy gzip tail or one or more framed Brotli
batches, hashed, and added to the compact index on recovery, while a partial frame, partial gzip tail,
corrupt metadata, or payload mismatch fails closed. The inner rows remain complete agent-cycle trace
objects: no fields are sampled or discarded.

`file-event-store-runtime-index-v3` preserves every authoritative event while changing new stream
writes from plain JSONL to independently readable uint32-length-prefixed raw-deflate JSONL batches.
Each stream union-reads an optional v1/v2 JSONL prefix followed by the v3 compact tail, retains only the
latest 1,024 events and at most 4,096 sparse checkpoints in memory, and cold-reads either representation
from the nearest retained checkpoint or byte zero. Sequence continuity is verified across the format
boundary; legacy growth after compact frames exists, incomplete frame headers/payloads, corrupt
compression, malformed JSON, replacement, truncation, and sequence gaps fail closed. Offline exact
identity redaction rewrites both representations and then rebuilds integrity-bound idempotency records,
so compression does not weaken participant deletion guarantees.

`file-short-term-memory-storage-v2` applies the same independently readable frame protocol to new
short-term-memory writes. A partition keeps an optional `short-term-memory.jsonl` legacy prefix and a
`short-term-memory.deflate` compact tail; append sequence is the ordered union of both files. The hot
projection remains bounded per Agent and keeps bounded cross-format sparse checkpoints, while ledger
queries cold-scan from the nearest safe JSONL row or compact-frame boundary without dropping records.
Legacy JSONL growth after the compact tail begins, incomplete frames, corrupt compression, malformed
JSON, replacement, and truncation fail closed. Offline participant deletion rewrites non-event compact
frames through the shared protocol before its residual scan, so memory compression does not create an
identity-retention exception.

Idempotency retains the latest 1,024 records plus a fixed 16,777,216-bit Bloom filter and resolves
possible matches through an exact cold scan. New records store the request SHA-256, stream/version
metadata, event first-sequence/count, and an integrity hash in independent framed-deflate records; exact
replay reconstructs the original returned events from the authoritative union stream and rechecks the
request hash. After each additional 4 MiB, the single writer atomically streams those records into
1,024-record compressed JSONL frames and validates record count plus per-record integrity before rename;
this removes small-frame write amplification without retaining the complete ledger in memory or dropping
deduplication history. The reader accepts both single-record and repacked frames, still consumes v1
inline-event rows during migration, and rejects legacy idempotency growth after compact data exists.

An old binary cannot safely write layout 3 because it cannot see compact event or duplicate-suppression state.
Rollback therefore always means restoring the untouched v1 source copy with the old binary, never
switching only the executable on the v2 root. Separately, v2/v3 trace readers can reconstruct a complete
compressed trace tail into the legacy index, but a pre-v2 binary cannot query post-upgrade gzip traces.
Back up all four trace files, both event idempotency files, every event stream's JSONL/deflate pair,
every short-term-memory JSONL/deflate pair, checkpoints, and snapshots together; treat
gzip/JSONL/deflate/index validation failure as integrity failure rather than skipping damaged evidence.

## Dead-letter response outside a drill

The daemon SLO reports every dead letter as `attention`. Preserve the daemon status, queue job, attempts,
error, run manifest, and operation trace before taking action. The recovery host enforces replay-count
and per-run limits; jobs beyond those limits remain dead-lettered for operator review. Do not edit the
JSONL queue by hand. If replay is authorized, use the runtime queue/recovery API so attempt and replay
provenance remain append-only.

Long-running queue jobs renew their lease every one-third of the configured lease duration. Polling,
recovery, and manual drain calls share one single-flight worker host; only one local claim may execute
at a time. Completion and failure rows are fenced by both worker ID and attempt number, so an expired or
reclaimed attempt cannot overwrite the terminal state of its successor. Missing renewals remain visible
as expired leases and are recoverable, but stale workers fail their terminal transition instead of
silently corrupting queue counters.

Interrupted lifecycle batches persist progress after every completed tick and resume the remaining
tick suffix under the original operation identity. A replay may reconstruct an authority decision in
memory while deliberately leaving its inbox delivery unmaterialized; such a projection is never saved
against the older partition stream version. The following normal materialization appends and
acknowledges that delivery before a new checkpoint is published. Snapshots remain a disposable replay
accelerator: if replaying a valid stream tail on a checkpoint violates a domain invariant, hydration
retries from the trusted initial projection and the complete authoritative event prefix. Recovery only
succeeds when that complete event replay succeeds; a corrupt event stream still fails closed.

## Verification and rollback acceptance

A restored or migrated copy is promotable only when:

- the recovery drill artifact status is `pass` and its source revision matches the release;
- checkpoint reference/hash equality and post-restart advancement are both true;
- the injected dead letter finishes as `completed` with the expected replay provenance;
- the compatibility marker and resolved manifest both report
  `local-runtime-data-compatibility-v2`/layout 2;
- a migrated root's registered migration artifact passes its content hash, reports equal before/after
  source-tree hashes, and every latest projection checkpoint hydrates from a snapshot under the target
  root;
- `pnpm check`, `pnpm build`, and the daemon SLO endpoint pass for the release candidate.

If any condition fails, keep the candidate offline, retain its evidence, and roll back to the untouched
copy and compatible binary. Do not reinterpret a partial drill as successful recovery.
