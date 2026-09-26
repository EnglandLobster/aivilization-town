# Frontend system

## Responsibility and authority

`apps/web` is an input/output adapter for the server-authoritative town. It owns presentation,
selection, camera position and observation state. It owns no domain aggregate and makes no economic,
movement, employment or lifecycle decisions. Commands go through the existing HTTP authority;
projections and durable events remain server-owned. This migration changes neither event schemas
nor policy versions.

## Architecture

- **React + TypeScript** own semantic DOM, navigation, forms, directories and inspection panels.
- **PixiJS 8** owns the WebGL map, retained scene graph, batched citizen particles, camera and picking.
  Its `pixi.js/unsafe-eval` compatibility entry installs static shader/particle synchronizers so the
  server keeps its strict CSP without granting `unsafe-eval`.
- **Vite** builds the browser application. `src/index.ts` exposes the existing `createTownWebAssets()`
  adapter, serving `dist/client` from the same server origin. HTML is not cached; hashed assets are
  immutable. Build metadata and arbitrary files are not publicly served. No CDN is required.
- **`client/store.ts`** is an external subscription store consumed through `useSyncExternalStore`.
  Snapshot publication drives DOM updates; Pixi's animation loop reads the last published world.
  It does not trigger React renders each frame.
- **`client/model.ts`** normalizes compatible read models. Society locations and public citizen
  directory take precedence over partition replicas. Private detail comes only from the selected
  owner partition. An absent directory transit must not revive an old partition transit.
- **`client/map/logic/`** contains framework-independent interpolation, roads, ambient, scenery,
  picking and calendar functions. Existing Node tests continue to exercise their contracts.

The former `public/app.js`, Canvas renderer and imperative panel renderers have been removed.
Historical Kenney assets and attribution remain under `public/ui/assets`. The active renderer uses
Roguelike Modern City and Roguelike Characters from `client/map/assets/`; the archived Tiny Town
sheet is not shipped. Original CC0 notices accompany both active sheets.

## Information architecture

| Workspace | User-facing purpose | Data |
| --- | --- | --- |
| Explore | See the town, inspect places, follow a citizen | Public directory, location registry, observed activity, transit, calendar, weather |
| Citizens | Search, filter and select residents | Public directory plus selected partition details; 50 rows per page |
| Economy | Inspect supply, reserves and recent exchange evidence | Society market authority, bounded trades and OHLC requests |
| Minds | Follow an individual's intentions, memories and decisions | Selected owner's plans, profile, decision and renewal traces |
| Participate | Authenticate, register a citizen, submit intentions and guidance | Existing access, registration, objective, reactive-command and steering APIs |
| Mission control | Run/pause/resume, change observation scope, inspect bulletins, validate and replay | Runtime, daemon, partitions, bulletin and validation read models |

The inspector links location occupancy to residents, residents to their observed state, and residents
to cognition. Unknown fields are shown as unavailable rather than invented values. Counts identify
observation windows or partition scope where they are not town-wide. Post-bootstrap registration
and intervention outcomes remain durable server commands.

## Observation lifecycle

1. Load runtime discovery and access/daemon status, then the selected projection and public society
   read models. Optional endpoint failures are visible and preserve the last successful observation.
2. Open the existing partition SSE stream. `sync-batch` notifications coalesce for 250 ms before
   refreshing the snapshot. A configurable visible-page polling interval covers missed notifications.
3. Load bounded, expensive evidence only for the active panel. Selection of a citizen owned by
   another partition switches the detail scope before requesting cognition.
4. Abort invalidated reads and reject responses from an older scope revision. A submitted command
   has a separate request lifetime so navigation does not cancel it.
5. Keep explicit participant consent, Bearer authentication and server authorization. Tokens use the
   existing session-storage key. Credentials never enter town state or the map.

**Current limit:** SSE still invalidates full snapshots. It is not a delta transport. The directory
is still fetched as a whole, and selection lookup/picking and some model normalization remain
linear in the observed population. The backend `headless-stress-1000` profile does not establish
browser capacity or a tens-of-thousands-agent production deployment.

## Map rendering and honesty

The presentation is an orthogonal pixel town with cream interface surfaces and quiet typography.
Kenney’s CC0 city tiles compose distinct homes, a school, clinic, restaurant, market, workshop and
public square, with matching roads, paving, trees and street furniture. Citizens use the CC0
Roguelike Characters sheet. Atlas textures use nearest-neighbor sampling; no paid or externally
hosted art is required. Vite builds hashed PNG assets served by the existing server. See
`apps/web/client/map/assets/ATTRIBUTION.md` for original archive URLs and licenses. Light and dark
interfaces share the same semantic layout. Normalized domain coordinates are unchanged;
`geometry.ts` provides the invertible orthogonal presentation transform.

- Static scenery is retained and rebuilt only when location geometry, snow or relevant land values
  change. The scene uses shared atlas frames, sprites, tiled ground and a Container tree; it is **not** baked
  to RenderTexture. `townArt.ts` owns frame lifetime and `townBuildings.ts` owns tile composition. Known PNG assets
  skip automatic format detection and blob-worker decoding to keep the strict CSP intact.
- Citizen sprites are reused by ID. Particle batches contain only visible individuals. Distant large
  populations and dense locations use aggregate occupancy; route colors use observed traffic.
- A city view above 1,200 citizens aggregates at the overview zoom. Locations above 1,200 residents
  stay aggregated even when zoomed in. More than 1,200 simultaneous journeys use route flows at all
  zoom levels. The directory and inspector preserve access to individuals.
- Movement remains deterministic interpolation over observed transit windows and road paths.
  Decorative resident drift is placed in the location forecourt to avoid walking over roofs; it is
  presentation, not a new authoritative position or decision. The time
  overlay labels movement as interpolated; animation extrapolation is capped at five seconds.
- Production smoke is conditional on observed occupancy; activity badges, conversation links,
  day/night tint and weather follow available read models. Missing facts do not become fake events.
- Camera pan/zoom/focus run independently of data refresh. Non-map workspaces and hidden tabs stop
  rendering; active rendering is capped at 60 FPS. Reduced-motion preference suppresses decorative animation and camera easing.
- WebGL initialization failure shows recovery information and links to the usable DOM directory.

The 30,000-citizen unit fixture checks normalization/grouping correctness, **not frame rate**.
Shipping a large city requires measuring realistic devices, transit density, memory, API payloads,
SSE pressure and backend simulation cost together. Next transport work should add versioned public
snapshot deltas and spatial subscriptions; subsequent rendering work should profile spatial indices
and transit-path caching. These are separate changes, not performance guarantees of this migration.

## Accessibility and responsive behavior

The shell has semantic navigation, an accessible skip link, visible focus rings, native forms,
labelled controls, status outputs and table headings. All places have DOM buttons and all citizens
are accessible through a searchable, paginated directory. Canvas picking is never required to read
or operate on a citizen. Escape returns to the map and closes the inspector.

Wide displays use a left place rail, central city/workspace and optional inspector. Narrow displays
hide the rail, keep navigation available, and overlay inspection without document-level horizontal
overflow. Dense tables scroll within their containers. GPU controls have accessible button names;
no hover-only control is required. Contrast and assistive-technology behavior should continue to be
reviewed as panels evolve; this document is not an accessibility certification.

## Build and development

```sh
pnpm --filter @aivilization/web build
# Start the runtime separately on port 4317 for the dev proxy:
pnpm --filter @aivilization/server start -- --profile smoke-25 --llm-mode deterministic --port 4317
pnpm --filter @aivilization/web dev -- --host 127.0.0.1 --port 4318
```

Vite serves `/ui/` and proxies `/runtime`, `/simulations` and `/access` to `127.0.0.1:4317`.
Production uses the server's `/` or `/ui/` after `pnpm build`. Rebuild browser assets and restart the
server to pick up production changes. A missing client build fails with an explicit build instruction.
`pnpm test` builds the browser first so server asset-contract tests exercise real hashed output.

Required verification: `pnpm lint`, `pnpm -r --sort typecheck`, `pnpm test`, `pnpm build`, plus browser
checks of production CSP, the real runtime, selections, panel navigation, commands and mobile layout.
Node tests deliberately do not import Pixi or require a GPU. Tests cover old snapshots, authority
precedence, stale responses, consent, lazy resources and deterministic map logic.
