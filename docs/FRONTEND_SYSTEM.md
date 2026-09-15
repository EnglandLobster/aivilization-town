# Aivilization frontend system

## Product position

The web application is a **living-city observatory**: the pixel-town canvas is the first-class
surface, and the evidence panels arrange themselves around it. It is neither a generic
administration dashboard nor a game HUD. Every surface must help an operator or researcher answer
one of four questions:

1. Is the simulation trustworthy and progressing?
2. What is happening in the population and economy?
3. Why did an Agent decide or act this way?
4. What intervention was submitted, authorized, and durably observed?

The canvas answers the continuous form of question 2 at a glance; everything else drills down from
it.

## Information architecture

The default view is the full-stage canvas town. The five workspaces are overlay panels on top of
it, toggled from the workspace rail (or closed back to the map), with hash routing kept compatible
(`#overview`, `#town`, `#market`, `#cognition`, `#steering`; empty or `#map` is the bare canvas):

| Workspace       | Primary question                                                     | Mutability                |
| --------------- | -------------------------------------------------------------------- | ------------------------- |
| Mission control | Is the runtime healthy, reproducible, and operable?                  | Read plus runtime control |
| Population      | Who exists, where are they, and what state are they in?              | Read                      |
| Economy         | What are pools, prices, exchanges, and aggregate observations doing? | Read                      |
| Cognition       | What plan, memory, and trace explains an Agent's behavior?           | Read                      |
| Interventions   | What durable human command should enter the simulation?              | Write                     |

Around the canvas:

- **Top context bar**: partition selection, refresh cadence, connection, theme, bulletin badge.
- **Right inspector drawer**: click a building for residents/capacity/incoming travelers; click an
  agent for a condition-aware summary and a path into the cognition workspace; `Esc` deselects.
- **Bottom intervention dock**: objective, reactive-command, and replay forms as collapsible
  sections. Access, registration, and steering traces stay in the Interventions workspace.

Context has three levels and must never be visually conflated:

- Global runtime: connection, daemon health, refresh cadence, and theme.
- Partition: simulation ID and partition key selected in the context bar.
- Entity: selected Agent or building on the canvas, market pool, plan, trace, or operation inside a
  workspace.

## The canvas and its honesty contract

Agents have **no continuous coordinates** in any projection. The map is a semantic visualization:

- Buildings render at their authoritative normalized `mapPosition` rects (center-based, 0–1).
- The road network is synthesized from the authoritative `connections` graph: every connection
  becomes a deterministic orthogonal (elbow) pixel road between building borders
  (`ui/map/roads.js`). The same waypoints drive traveler movement, so people visibly walk along
  the streets, including multi-hop `routeLocationIds` routes. Without a connection graph the
  module falls back to straight center-to-center segments.
- Resident agents drift inside their location rect via a deterministic agentId-hash function of
  time — no randomness, replayable frame-for-frame.
- Traveling agents interpolate over the road waypoints using the authoritative
  `departedAt`/`arrivesAt` timestamps against the simulation clock (last authoritative
  `clock.now` plus wall-clock elapsed).
- Traffic heat on roads comes only from authoritative transit data (`routeEdgeFlows` active
  traversal counts, or active transits per hop when the authority publishes no flows). Green →
  amber → red heat plus a counter badge at high congestion; no invented vehicles.
- Scenery (trees, bushes, rocks, flowers), lampposts and the maritime shoreline are deterministic
  decoration (`ui/map/decor.js`) placed by hash on a grid, never intersecting buildings, roads or
  water. The shoreline is derived from maritime region ids (e.g. `harbor`); regional ground tints
  reflect the authoritative `regionalLandValues` slice. All counts (occupancy, incoming,
  population) come from the projection only.
- The day/night layer (`ui/map/dayNight.js`) reads the flag-gated `calendar` slice and maps the
  authoritative phase onto a smooth darkness/warmth ramp (mirrored `town-calendar-v1` phase
  table): cool night tint, warm dawn/dusk wash, occupancy-proportional lit windows at night, and
  lamp glows. The HUD clock chip shows "Day N · Phase".
- Ambient life (`ui/map/ambient.js`): ongoing activities (`activityTimeByAgent`) render as
  per-agent bubbles (sleep z's, work hammer, trade coin…), recent conversations
  (`conversationRecords`) as short-lived speech links between participants, and the `townPulse`
  ring as a fading town-news ticker in the canvas corner. Birds by day and fireflies at night are
  purely decorative and deterministic.
- Chimney smoke rises over occupied production/food buildings; agents wear deterministic
  palette bands so citizens read as individuals.

The UI states this plainly with the on-map label "semantic layout · interpolated movement".
Implementation: `public/ui/map/interpolation.js` (pure, unit-tested), `renderer.js` (Canvas 2D
layer pipeline: static bake [terrain · region tints · water · plaza · roads · scenery ·
lampposts] → water shimmer → traffic heat → buildings → agents → ambient → weather → day/night
→ selection), `roads.js`, `decor.js`, `dayNight.js`, `ambient.js`, `picking.js`, `tilesheet.js`,
`weatherLayer.js` — all pure modules except the renderer, all unit-tested where logic lives.

Flag-gated mechanisms render only when the projection carries the field: `weather` (tint,
particles, storm lightning, fog banks; snowy weather also re-tints treetops), `calendar`
(day/night + clock chip), `regionalLandValues` (region ground tints), society
`agentConditions`/`conflictRecords` (markers above agents), `bulletins` (topbar badge + board in
the inspector), `townPulse`/`activityTimeByAgent`/`conversationRecords` (ticker, bubbles,
speech links). Missing fields render nothing and produce no errors.

## Assets and build

- `public/ui/assets/tiles.png` is a 16px-tile pixel sheet derived from Kenney "Tiny Town" (CC0 —
  see `public/ui/assets/ATTRIBUTION.md`) by `apps/web/tools/repack-kenney-tilesheet.py`, which
  composes the source tiles onto the layout contract below. The agent walk sprites and selection
  bracket on the last row remain original placeholder art from
  `apps/web/tools/generate-tilesheet.mjs` (dependency-free Node: hand-rolled PNG encoder over
  `node:zlib`), which also serves as the procedural fallback when the Kenney pack is unavailable.
  Building sprites are organized as 7 location kinds × 3 upgrade levels; only level 1
  is drawn today — levels 2–3 are reserved frames for spatial growth (#8), and a day/night tint
  layer is reserved for the world clock (#12). The PNG is committed.
- All assets are explicitly registered in `createTownWebAssets()` (`apps/web/src/index.ts`) and
  served same-origin by the Node static gateway with exact-path matching. JavaScript modules are
  `no-cache`; the tilesheet is immutable. CSP (`script-src 'self'`) is satisfied by plain ES
  modules — no inline scripts, no bundler, no runtime dependencies.

## Design language

The visual language is an editorial laboratory notebook rather than a conventional blue enterprise
console. Warm paper surfaces and ink-colored type keep dense evidence readable. A single moss accent
marks selection, progress, and primary action; rust is reserved for destructive or failed states.
The canvas sits inside this frame as the living exhibit.

### Core tokens

- Background: warm paper, with a deep green-black equivalent in dark mode.
- Surface hierarchy: paper, raised sheet, inset evidence field.
- Primary text: ink; secondary text: slate-brown.
- Accent: moss green. It carries selection and action, never decoration alone.
- Typography: an editorial serif for workspace titles, a humanist sans serif for interface text, and
  tabular monospace for IDs, timestamps, sequences, and measurements.
- Radius: restrained and hierarchical. Large sheets use 18px, controls 8px, evidence tags 4px.
- Motion: 160–240ms opacity and transform transitions only; reduced-motion preferences win.

## Component rules

- The application shell uses a masthead and horizontal workspace rail. It avoids a permanent
  sidebar so the canvas and wide research tables retain horizontal space.
- The context bar is the only place that changes partition and refresh cadence.
- Metrics form an asymmetric evidence strip; values always use tabular figures.
- Cards are reserved for bounded evidence groups. Related tables may share one continuous surface.
- The canvas owns spatial selection; overlays and the inspector drawer never mutate simulation
  state by themselves — they only select, filter, or route into forms.
- Forms have explicit labels, inline results, and visible authorization context. Destructive
  controls cannot share the primary-action treatment.
- Loading uses layout-shaped skeletons. Empty states say what evidence is absent. Errors stay close
  to the failed surface and preserve partial data elsewhere.
- Status must use text and shape in addition to color.

## Responsive behavior

- At 1180px, asymmetric evidence grids collapse to one column where comparison is no longer useful,
  and the intervention dock wraps to two columns.
- At 860px, the workspace rail becomes a horizontally scrollable, sticky tab strip; context controls
  form a two-column grid; the dock stacks vertically; overlays and the inspector go full-width.
- At 560px, metrics and forms become single-column, tables scroll inside their evidence surface, and
  primary actions use the full available width.
- Below 860px, the canvas keeps a playable 760px minimum width inside its own horizontal scroller;
  the document itself must not gain horizontal overflow.
- The application uses `min-height: 100dvh` and never relies on a fixed mobile viewport height.

## Accessibility and interaction contract

- Keep the skip link, semantic landmarks, tab roles, keyboard navigation, and visible focus rings.
- Horizontal workspace tabs respond to left/right arrows; vertical up/down behavior is retained as a
  compatibility fallback. Activating the already-active tab closes its overlay back to the map.
- Announcements use the existing polite live regions. A successful result does not use an
  exclamation mark; an error states the failed action and recovery path.
- Canvas selection has DOM equivalents: buildings and agents remain selectable from the Population
  workspace (locations grid, agent table), and every canvas drill-down is mirrored in the inspector
  drawer with real buttons. Selecting a resident synchronizes the canonical Agent table and detail
  panel.
- Color contrast targets WCAG AA. All dense numeric fields use tabular figures and retain text
  labels.

## Implementation boundary

The application remains dependency-free vanilla HTML, CSS, and JavaScript, now organized as native
ES modules: `app.js` only bootstraps (context bar wiring, router, SSE, assembly); render logic
lives in `public/ui/panels/*`, map machinery in `public/ui/map/*`. Existing DOM IDs, API routes,
authentication behavior (`sessionStorage['aivilization.access-token']`), SSE invalidation
(`sync-batch` → debounced `refreshAll`), and form submissions are stable contracts. Pure map logic
(interpolation) is unit-tested via the `@aivilization/web` vitest project; the rest of `public/` is
served statically and pinned through the server-side asset contract tests.
