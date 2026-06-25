# Social Reflection Observation API Design

## Purpose

Expose durable social reflection observations through backend API surfaces so future Godot clients,
debug panels, and validation jobs can inspect post-interaction reflection without coupling to
memory consolidation internals.

## Paper Alignment

AIvilization treats social interaction reflection as part of the agent loop: social events update
internal social models, enter memory, and later shape behavior. The backend now records
`SocialReflectionObservation` rows durably. The remaining backend gap is query access. Without an
API, those rows are only useful to code with direct filesystem/repository access.

## Design Goals

- Follow existing trace API patterns: small request-normalizing API service, optional HTTP service,
  local server wiring from runtime storage.
- Keep `SimulationApiService` focused on core simulation/event/market surfaces; social reflection
  observations remain an observability read model.
- Support exact lookup by `observationId` plus filtered query by simulation, partition, agent,
  target, generated-at window, and limit.
- Keep observability repository responsible for idempotent persistence and read-model lookup.
- Make HTTP routes stable for Godot:

```text
GET /simulations/:simulationId/partitions/:partitionKey/social-reflection-observations
GET /simulations/:simulationId/partitions/:partitionKey/social-reflection-observations/:observationId
```

## Non-Goals

- Do not add UI or Godot integration.
- Do not add new reflection synthesis behavior.
- Do not move social reflection observations into `SimulationApiService`.
- Do not add validation metrics in this slice.

## Proposed Architecture

Add `apps/api/src/socialReflectionObservationApi.ts`:

- `SocialReflectionObservationLookupRequest`
- `SocialReflectionObservationQueryRequest`
- `SocialReflectionObservationQueryPort`
- `createSocialReflectionObservationApiService()`

Extend `packages/observability/src/socialReflectionObservationRepository.ts` with:

- `get(observationId)`
- optional `observationId` filter on `query()`

Wire `httpApi` with an optional `socialReflectionObservations` service. Wire
`localRuntimeTownServer` by adapting each partition backend's
`storage.socialReflectionObservationRepository`.

## Testing

- Observability repository tests prove exact lookup and query-by-observation id.
- API service tests prove request normalization and invalid input rejection before delegation.
- HTTP tests prove route parsing, query parsing, lookup route, optional-service 404, and bad limit.
- Local runtime server tests prove records written to local storage are served over HTTP.

## Future Extensions

- Add social-coherence validation metrics over these observations.
- Add group/cross-agent reflection aggregations.
- Add streaming/SSE updates once Godot needs live reflection panels.
