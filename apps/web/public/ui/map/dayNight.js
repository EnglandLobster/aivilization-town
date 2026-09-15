/**
 * Day/night layer math for the living-town canvas (pure module).
 *
 * Reads the flag-gated projection `calendar` slice
 * (`{ dayIndex, phase, since }`, see `packages/world/src/projection.ts` —
 * `town-calendar-v1`). The phase itself is authoritative; the smooth darkness
 * ramp inside a phase is a *visualization* of the canonical phase table
 * (night → dawn → day → dusk → evening, 86 400 000 sim-ms per day). When the
 * calendar switch is off the projection omits the field and every helper
 * returns an idle result — no tint, no window lights.
 */

const DAY_LENGTH_MS = 86_400_000;

/**
 * Canonical phase layout (`town-calendar-v1`, mirrored from
 * `packages/content/src/scenarios.ts`) — phase start fractions of the day.
 */
const PHASES = [
  { phase: 'night', start: 0 },
  { phase: 'dawn', start: 0.175 },
  { phase: 'day', start: 0.3 },
  { phase: 'dusk', start: 0.8 },
  { phase: 'evening', start: 0.875 },
];

/**
 * Darkness keyframes over the day fraction: deep night, easing through dawn
 * to a bright midday floor, then down through dusk and evening again.
 */
const DARKNESS_KEYFRAMES = [
  { at: 0, value: 1 },
  { at: 0.175, value: 0.62 },
  { at: 0.3, value: 0.02 },
  { at: 0.55, value: 0 },
  { at: 0.8, value: 0.34 },
  { at: 0.875, value: 0.74 },
  { at: 1, value: 1 },
];

/** Dawn and dusk spans get a warm wash, peaking mid-span. */
const WARM_SPANS = [
  { lo: 0.175, hi: 0.3 },
  { lo: 0.8, hi: 0.875 },
];

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function darknessAt(dayFraction) {
  const fraction = clamp01(dayFraction);
  for (let index = 1; index < DARKNESS_KEYFRAMES.length; index += 1) {
    const from = DARKNESS_KEYFRAMES[index - 1];
    const to = DARKNESS_KEYFRAMES[index];
    if (fraction <= to.at || index === DARKNESS_KEYFRAMES.length - 1) {
      const span = to.at - from.at || 1;
      const t = clamp01((fraction - from.at) / span);
      return from.value + (to.value - from.value) * t;
    }
  }
  return 1;
}

function warmthAt(dayFraction) {
  const fraction = clamp01(dayFraction);
  for (const span of WARM_SPANS) {
    if (fraction >= span.lo && fraction <= span.hi) {
      return Math.sin(((fraction - span.lo) / (span.hi - span.lo)) * Math.PI);
    }
  }
  return 0;
}

/**
 * Resolves the continuous daytime state for a projection calendar slice.
 * Returns `null` when the calendar is absent or the phase is unknown (the
 * caller must treat the layer as idle, never guess).
 */
export function resolveDaytime(calendar, nowMs) {
  if (!calendar?.phase) return null;
  const index = PHASES.findIndex((entry) => entry.phase === calendar.phase);
  if (index < 0) return null;
  const current = PHASES[index];
  const next = PHASES[(index + 1) % PHASES.length];
  const nextStart = next.start > current.start ? next.start : 1;
  const phaseSpanMs = (nextStart - current.start) * DAY_LENGTH_MS;
  const since = Number.isFinite(calendar.since) ? calendar.since : nowMs;
  const phaseProgress =
    phaseSpanMs > 0 ? clamp01((nowMs - since) / phaseSpanMs) : 1;
  const dayFraction = current.start + (nextStart - current.start) * phaseProgress;
  return {
    phase: current.phase,
    phaseProgress,
    dayFraction,
    darkness: darknessAt(dayFraction),
    warmth: warmthAt(dayFraction),
    dayIndex: Number.isFinite(calendar.dayIndex) ? calendar.dayIndex : 0,
  };
}

/** True when the night overlay should light building windows and lamps. */
export function isNightlightTime(daytime) {
  return Boolean(daytime) && daytime.darkness >= 0.35;
}

/**
 * Overlay fills for one daytime state: a cool night tint whose alpha tracks
 * darkness plus a warm dawn/dusk wash. Returns `null` when effectively day.
 */
export function daytimeOverlays(daytime) {
  if (!daytime || (daytime.darkness < 0.04 && daytime.warmth < 0.04)) return null;
  const overlays = [];
  if (daytime.darkness >= 0.04) {
    overlays.push({ color: `rgba(24, 32, 74, ${(daytime.darkness * 0.42).toFixed(3)})` });
  }
  if (daytime.warmth >= 0.04) {
    overlays.push({ color: `rgba(255, 150, 70, ${(daytime.warmth * 0.12).toFixed(3)})` });
  }
  return overlays.length > 0 ? overlays : null;
}

/** Short HUD label, e.g. "Day 3 · Dusk". Empty string when idle. */
export function describeDaytime(daytime) {
  if (!daytime) return '';
  const phase = daytime.phase.charAt(0).toUpperCase() + daytime.phase.slice(1);
  return `Day ${daytime.dayIndex + 1} · ${phase}`;
}
