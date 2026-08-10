# Production Observability and SLOs

The canonical town exposes a versioned `production-runtime-slo-v2` snapshot at
`GET /runtime/daemon/status` under `productionSlo`. The same effective policy is embedded in the
content-addressed resolved run manifest. This makes every threshold attributable to a run instead of
leaving operational semantics in an external dashboard.

The report is a point-in-time SLI evaluation. It is not a historical availability percentage. A
monitoring system may sample and retain it to compute availability, burn rate, and paging windows, but
must preserve the report's manifest ID, observation time, policy version, measurements, and violations.

## Objectives and thresholds

| Check                         | Objective                                                                                 | `production-runtime-slo-v2` threshold                                                                                                                                                                                                                                                                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Daemon health                 | All configured supervisor, queue, worker, scheduler, and recovery components are healthy. | Base daemon health must be `healthy`.                                                                                                                                                                                                                                                                                                                                |
| Run queue lag                 | Ready work stays within configured capacity and cadence, without unrecovered poison jobs. | Ready depth is at most the profile's `maxPendingJobs`; oldest ready age is at most five times the slower worker/scheduler cadence, with a 10-second floor; dead-letter and expired-lease counts are zero.                                                                                                                                                            |
| Projection checkpoint lag     | Every scheduled partition can restart from a checkpoint current with its event stream.    | Sequence lag is zero; wall-clock age is at most five scheduler intervals, with a 10-second floor. The check is N/A when the scheduler is not expected to run.                                                                                                                                                                                                        |
| LLM reliability and cost      | Model-backed cognition remains observable, reliable, and inside a bounded cost envelope.  | In the most recent simulated hour, fallback/failure ratio is at most 5% and estimated cost is at most 5,000,000 configured cost micros. Provider mode requires explicit input/output token prices; completed cycles with missing pricing or no provider trace fail. Hitting a trace collection safety limit fails. Deterministic mode is N/A, not provider evidence. |
| Market observation lag        | Recent trades have a covering OHLC record while data remains bounded.                     | For every commodity traded in the recent window, a covering bar must exist and partition lag must be at most 600,000 simulated milliseconds, equal to two canonical five-minute bins. No recent trades is N/A. Hitting a collection limit fails.                                                                                                                     |
| Recovery readiness            | Recovery stays available and within cadence.                                              | When configured to run, the host is running, has no last error, and its last completed check is no older than five recovery intervals, with a 10-second floor.                                                                                                                                                                                                       |
| Experiment artifact integrity | Every artifact registered with the live runtime passes its repository integrity check.    | Verified ratio is 100%; one failed artifact fails the check. No registered artifact is N/A. The canonical runtime registers its content-addressed run manifest; experiment-specific repositories continue to enforce immutable JSON/SVG integrity on read.                                                                                                           |

The 5% provider failure target, 5,000,000-micro simulated-hour cost budget, cadence multipliers, and
10-second floors are repository operational decisions, not paper constants. They are deliberately part
of the versioned policy so future calibration cannot silently reinterpret old runs. Cost micros only
have financial meaning when the run manifest records a valid provider pricing configuration.

## Data flow and accounting boundaries

- Daemon and recovery measurements come from live host status; queue measurements come from the durable
  run-job repository.
- Checkpoint lag compares the durable event-stream version with the latest durable projection
  checkpoint. A checkpoint ahead of its event stream is also a failure.
- LLM accounting traverses durable objective, daily-plan, reaction, steering, agent-cycle, replanning,
  dialogue, global-synthesis, repair, reflection, and social-model traces only when a Provider is
  configured. It counts each top-level provider decision once and does not double-count its retry
  attempts. Provider and model IDs, tokens, estimated cost, fallback count, and collection truncation
  are reported. Deterministic mode is definitionally N/A, so v2 skips those complete-history Provider
  trace queries rather than spending runtime capacity to derive a result whose policy is already N/A.
- Market freshness uses durable trade observations and OHLC revisions from the same simulation-time
  window. A bar counts only if its interval actually covers the latest trade for that commodity.
- Resolved run manifests are registered when the supervisor is created, before the first cycle. Reads
  recalculate their content hash; missing or tampered files fail artifact integrity.

## Alerting and first response

The canonical API elevates overall daemon health to `attention` whenever any SLO check fails. A
production monitor should page on two consecutive `attention` samples for daemon, checkpoint,
artifact, or dead-letter failures; queue age, provider failure/cost, market lag, and recovery freshness
may use a short burn window appropriate to the deployment cadence.

First response should preserve evidence before mutation:

1. Save the full daemon status and current resolved run manifest ID.
2. Inspect the failed check's measurements and violations; do not infer the cause from overall health.
3. For queue/recovery failures, inspect run-job attempts and recovery reports before replaying a dead
   letter.
4. For checkpoint failures, compare event-stream version, checkpoint sequence, lifecycle state, and the
   latest supervisor operation trace before restarting.
5. For LLM failures, group by provider/model/failure reason and verify pricing configuration; a
   deterministic fallback is an outage signal, not a successful provider request.
6. For market lag, retain the relevant trade and OHLC windows and verify that the latest commodity trade
   is covered by a matching interval.
7. For artifact failures, stop deriving scientific conclusions from that run. Preserve the file for
   forensic comparison; create a new run/artifact rather than overwriting immutable evidence.

Deployment procedures, destructive recovery approval, checkpoint restore drills, dead-letter replay
drills, and data migration compatibility are documented in
[`DEPLOYMENT_AND_RECOVERY.md`](DEPLOYMENT_AND_RECOVERY.md). The current implementation boundary is
summarized in [`PAPER_ALIGNMENT_MATRIX.md`](PAPER_ALIGNMENT_MATRIX.md).
