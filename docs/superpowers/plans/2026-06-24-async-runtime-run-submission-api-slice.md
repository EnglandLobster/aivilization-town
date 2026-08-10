# Async Runtime Run Submission API Slice

## Goal

Expose the durable runtime run queue through a stable API and HTTP boundary so long-running simulation cycles can be submitted asynchronously without coupling callers to local worker internals.

## Design

- Add an API-layer `RuntimeRunQueueApiService` with two operations:
  - submit a runtime run job
  - look up a runtime run job by id
- Keep the API boundary generic: it validates request shape and delegates to a control port, but it does not know whether jobs are backed by memory, files, Redis, or a cloud queue.
- Add a worker adapter that maps the generic API request onto the local simulation runtime run queue repository with the current manifest id.
- Add HTTP routes:
  - `POST /runtime/run-jobs`
  - `GET /runtime/run-jobs/:jobId`
- Keep synchronous `POST /runtime/run` unchanged.
- Wire the local runtime server with a default file-backed run queue repository under the existing operations root.

## Verification

- API unit tests for request normalization and delegation.
- HTTP router tests for async job submission and lookup.
- Worker adapter tests for manifest-aware queue mapping.
- Local server integration test proving the default server exposes the file-backed queue through HTTP.
- Targeted package typecheck/test plus lint and diff checks before commit.
