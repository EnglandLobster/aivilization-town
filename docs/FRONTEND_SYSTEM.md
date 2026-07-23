# Aivilization frontend system

## Product position

The web application is a research observatory for a living, replayable simulation. It is not a
generic administration dashboard and it is not a game HUD. Every surface must help an operator or
researcher answer one of four questions:

1. Is the simulation trustworthy and progressing?
2. What is happening in the population and economy?
3. Why did an Agent decide or act this way?
4. What intervention was submitted, authorized, and durably observed?

## Information architecture

The UI exposes five stable workspaces while preserving one simulation context:

| Workspace       | Primary question                                                     | Mutability                |
| --------------- | -------------------------------------------------------------------- | ------------------------- |
| Mission control | Is the runtime healthy, reproducible, and operable?                  | Read plus runtime control |
| Population      | Who exists, where are they, and what state are they in?              | Read                      |
| Economy         | What are pools, prices, exchanges, and aggregate observations doing? | Read                      |
| Cognition       | What plan, memory, and trace explains an Agent's behavior?           | Read                      |
| Interventions   | What durable human command should enter the simulation?              | Write                     |

Context has three levels and must never be visually conflated:

- Global runtime: connection, daemon health, refresh cadence, and theme.
- Partition: simulation ID and partition key selected in the context bar.
- Entity: selected Agent, market pool, plan, trace, or operation inside a workspace.

## Design language

The visual language is an editorial laboratory notebook rather than a conventional blue enterprise
console. Warm paper surfaces and ink-colored type keep dense evidence readable. A single moss accent
marks selection, progress, and primary action; rust is reserved for destructive or failed states.
Subtle grid lines make the surface feel measured without competing with data.

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

- The application shell uses a masthead and horizontal workspace rail. It avoids a permanent sidebar
  so wide research tables retain horizontal space.
- The context bar is the only place that changes partition and refresh cadence.
- Metrics form an asymmetric evidence strip; values always use tabular figures.
- Cards are reserved for bounded evidence groups. Related tables may share one continuous surface.
- Population uses one semantic pixel-town map rather than an inferred geographic diagram. The raster
  establishes visual identity only; seven HTML building controls own selection, live occupancy, current
  activity, capacity language, and resident drill-down. Counts always come from the active projection,
  and an unbounded canonical capacity is never replaced with a fictional number.
- Forms have explicit labels, inline results, and visible authorization context. Destructive controls
  cannot share the primary-action treatment.
- Loading uses layout-shaped skeletons. Empty states say what evidence is absent. Errors stay close to
  the failed surface and preserve partial data elsewhere.
- Status must use text and shape in addition to color.

## Responsive behavior

- At 1180px, asymmetric evidence grids collapse to one column where comparison is no longer useful.
- At 860px, the workspace rail becomes a horizontally scrollable, sticky tab strip; context controls
  form a two-column grid.
- At 560px, metrics and forms become single-column, tables scroll inside their evidence surface, and
  primary actions use the full available width.
- Below 860px, the town remains a legible fixed semantic canvas inside its own horizontal scroller;
  the document itself must not gain horizontal overflow.
- The application uses `min-height: 100dvh` and never relies on a fixed mobile viewport height.

## Accessibility and interaction contract

- Keep the skip link, semantic landmarks, tab roles, keyboard navigation, and visible focus rings.
- Horizontal workspace tabs respond to left/right arrows; vertical up/down behavior is retained as a
  compatibility fallback.
- Announcements use the existing polite live regions. A successful result does not use an
  exclamation mark; an error states the failed action and recovery path.
- Each town building is a real button with a location/count/activity accessible name and pressed state.
  Selecting a resident must synchronize the canonical Agent table and detail panel.
- Color contrast targets WCAG AA. All dense numeric fields use tabular figures and retain text labels.

## Implementation boundary

The current application remains dependency-free vanilla HTML, CSS, and JavaScript. Binary visual
assets are explicitly registered with the same-origin Node static gateway; they are never loaded from
local file paths or runtime CDNs. Existing DOM IDs, API routes, authentication behavior, SSE
invalidation, and form submissions are stable contracts.
The first redesign phase changes the shell, tokens, hierarchy, and navigation semantics without
rewriting data loading. Subsequent phases may extract render functions into modules only when the
server can serve hashed module assets and the change reduces, rather than redistributes, complexity.
