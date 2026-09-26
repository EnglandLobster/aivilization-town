# Frontend rebuild verification — 2026-09-25

## Delivered scope

The vanilla application and Canvas renderer were replaced with React, PixiJS and Vite. The existing
same-origin server, read APIs, authority checks and durable command endpoints remain the integration
boundary. See [Frontend system](../../docs/FRONTEND_SYSTEM.md) for the implemented architecture and limits.

## Repository gates

- `pnpm lint`: passed.
- `pnpm -r --sort typecheck`: passed.
- `pnpm test`: 275 test files passed, one skipped; 2,096 tests passed, one skipped.
- `pnpm build`: passed across the workspace.
- After final renderer refinements: web lint, web typecheck, web build and the web/server suites
  passed (29 test files, 174 tests).
- `git diff --check`: passed.

The existing skip was retained. The seven added frontend tests cover read-model normalization,
authority precedence and absence of stale transit, 30,000-person grouping, geometry, lazy resource
loading, obsolete partition responses and participant consent. Existing pure map tests were moved
with their framework-independent modules.

## Browser checks

Used `agent-browser` with Chrome 151 and the real `smoke-25` deterministic runtime, in isolated
`/tmp` runtime directories. Production verification used the server at port 4317, including its
actual CSP and built, hashed assets. Development at port 4318 was used for the synthetic fixture.

Verified:

- Citizen search narrows the table; selecting a citizen opens observed state and actual plans.
- Economy displays authoritative reserves and bounded observation windows.
- Run-cycles submission receives an accepted result from the runtime.
- Mobile place selection opens the location inspector; camera focus and reset operate.
- Light/dark layouts, desktop 1440×960 and mobile 390×844 render. Mobile document width equals
  viewport width; tables use their own overflow containers.
- Production map initializes with the strict CSP intact. An initial failure revealed Pixi's default
  dynamic code generation; its static compatibility entry fixed this without weakening CSP.
- The final production and synthetic browser sessions reported no JavaScript errors.

Screenshots were captured locally for desktop, dark mode, mobile, mobile inspection, cognition and
economy. They are review artifacts, not visual snapshot tests or an accessibility certification.

## Synthetic population smoke check (initial renderer migration)

The renderer received 30,000 synthetic citizens across the seven observed scenario places, with
10,000 synthetic simultaneous journeys. This modified only an independent browser scene, never
server state. It exercised overview, zoom, crowd aggregation and an individually selected citizen.

Environment: headless Chrome 151, ANGLE Vulkan SwiftShader software GPU. The final sample published
the scene in approximately 17 ms, with 89 requestAnimationFrame callbacks over a two-second overview
window and 46 over a two-second zoom window. These are short browser-liveness samples, **not GPU
frame-time benchmarks**, and contain camera transition and software rendering overhead. Scene
rendering is capped at 60 FPS. No claim of stable 60 FPS is established.

The initial sample exposed expensive detailed rendering of all 10,000 journeys. The final renderer
aggregates more than 1,200 journeys as route flows at every zoom level and keeps a selected person
visible. Dense residential groups likewise remain aggregated. Node tests separately verify exact
population/transit grouping without double counting.

## Remaining scale work

Full directory/snapshot transfer, server simulation throughput, sustained real-device frame times,
long-session GPU memory and large spatial datasets require separate measurement. This frontend
migration does not prove tens-of-thousands-agent end-to-end production capacity. The implemented
boundaries allow subsequent versioned delta transport, spatial subscriptions and path caching
without moving domain decisions into the browser.

The above timing sample predates the pixel-atlas artwork update; it has not been repeated as a
performance benchmark for the new artwork.

## Free pixel artwork update

The map now uses original CC0 Kenney Modern City and Roguelike Characters atlases, with an
orthogonal presentation transform. The original licenses and source archive URLs are included
under `client/map/assets/`. Per-location art assembles roof, wall, window, awning and street
furniture tiles; building pieces remain decoration within one authoritative location. Original
sheets are unmodified, and the browser loads their Vite-hashed PNGs from the town server.
Production verification for this update confirmed both hashed PNG requests return HTTP 200 with
`image/png` and immutable caching. The server integration test checks the actual PNG signature.
The asset loader explicitly disables format probes and blob workers under the strict production
CSP; map loading remains visible until both observations and rendering are ready. Canvas picking
on the market opens the Market inspector. Desktop, dark mode and mobile 390×844 were reviewed;
the mobile document has no horizontal overflow. The atlas files' SHA-256 hashes match the originals.

All repository lint/typecheck/test gates passed again (2,096 passed, one existing skip), the web
production build passed, and the final web/server regression passed (174 tests).
