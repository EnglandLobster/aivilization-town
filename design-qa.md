# Pixel Town Design QA

## Visual target

- Reference: `/path/to/user/.codex/generated_images/019f7ee0-e525-78d2-aac1-0edd46f60824/exec-eccc91c7-e7d3-4164-88f3-e590e933e59f.png`
- Production map asset: `apps/web/public/assets/town-map.png`
- Desktop implementation: `/path/to/user/.codex/visualizations/2026/07/20/019f7ee0-e525-78d2-aac1-0edd46f60824/pixel-town-desktop-final.png`
- Mobile implementation: `/path/to/user/.codex/visualizations/2026/07/20/019f7ee0-e525-78d2-aac1-0edd46f60824/pixel-town-mobile.png`
- Side-by-side comparison: `/path/to/user/.codex/visualizations/2026/07/20/019f7ee0-e525-78d2-aac1-0edd46f60824/pixel-town-qa-comparison.png`

## Viewports and state

- Desktop: explicit 1440 × 1024 browser viewport, Population workspace, Market selected.
- Mobile: explicit 390 × 844 browser viewport; rendered page viewport was 375 pixels wide because of the browser gutter.
- Runtime: isolated deterministic `smoke-25` partition with 25 canonical Agents.

## Comparison findings

- The implementation preserves the approved Observatory shell, warm paper surface, ink typography,
  moss accent, seven-place pixel town, building occupancy badges, selected-building treatment,
  inspector, and lower Agent directory.
- Runtime truth intentionally replaces mock values: School and Market counts come from the live
  projection; capacities remain open because the canonical location configuration is unbounded.
- Agent cards derive concise labels from canonical IDs instead of inventing personal names that the
  runtime does not provide.
- Existing partition, refresh, and runtime-health controls remain visible because they are part of the
  repository's established observability contract.
- On narrow screens the page itself does not overflow (`pageScrollWidth === pageClientWidth`); the map
  becomes an explicitly scrollable 760-pixel canvas so building labels and hit targets remain legible.

## Interaction checks

- Population and Activity layers toggle `aria-pressed` and update all seven badge readings.
- Selecting Market updates the selected outline and inspector to the current live resident count.
- Selecting `Agent 002` from the inspector selects the matching Agent table row and detail panel.
- “Show residents in directory” filters the table to the selected place; all returned rows matched
  `market` in the checked run.
- The final browser console contained no warnings or errors.

## Fix history

1. The first implementation put map geometry in inline style attributes. The repository CSP correctly
   rejected those styles, leaving semantic buttons present but visually collapsed.
2. Geometry moved into seven explicit stylesheet classes. The CSP remains strict and every hotspot now
   has a measurable hit area and visible badge.
3. Long canonical Agent IDs made the inspector noisy. Display labels now use deterministic `Agent NNN`
   aliases while retaining canonical IDs in data attributes and the detailed Agent panel.

final result: passed
