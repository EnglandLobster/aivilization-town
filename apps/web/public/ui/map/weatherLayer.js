/**
 * Weather overlay for the living-town canvas (flag-aware).
 *
 * Reads the optional `projection.weather` slice (`{ current, since }`, see
 * `packages/world/src/weather.ts`). When the town-weather switch is off the
 * projection omits the field and `setWeather(null)` disables the layer — no
 * particles, no tint, no errors. Precipitation particles, storm lightning,
 * and drifting fog banks are deterministic functions of (index, time bucket),
 * so frames are stable and replayable.
 */

const TINTS = {
  sunny: { color: 'rgba(255, 236, 170, 0.07)' },
  cloudy: { color: 'rgba(120, 130, 140, 0.14)' },
  windy: { color: 'rgba(150, 165, 175, 0.08)', streaks: true },
  rainy: { color: 'rgba(90, 110, 140, 0.16)', precipitation: 'rain' },
  stormy: { color: 'rgba(50, 60, 90, 0.26)', precipitation: 'rain', heavy: true, lightning: true },
  snowy: { color: 'rgba(220, 228, 238, 0.14)', precipitation: 'snow' },
  foggy: { color: 'rgba(190, 196, 200, 0.18)', fog: true },
};

const LIGHTNING_PERIOD_MS = 5200;

function particleSeed(index, bucket) {
  let hash = (index * 2654435761 + bucket * 40503) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177) >>> 0;
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967295;
}

export function createWeatherLayer() {
  let kind = null;
  let config = null;

  return {
    /** Accepts `projection.weather` (or `undefined`/`null` when flag-gated off). */
    setWeather(weather) {
      kind = weather && TINTS[weather.current] ? weather.current : null;
      config = kind ? TINTS[kind] : null;
    },

    /** The active weather kind, or null when the layer is idle. */
    kind() {
      return kind;
    },

    /** True when the projection carries no weather slice or an unknown kind. */
    isIdle() {
      return config === null;
    },

    /** Draws tint + particles in screen space (call after world layers). */
    draw(ctx, width, height, timeMs) {
      if (!config) return;
      ctx.save();
      ctx.fillStyle = config.color;
      ctx.fillRect(0, 0, width, height);

      if (config.precipitation === 'rain') {
        const count = config.heavy ? 110 : 55;
        const fallSpeed = config.heavy ? 0.95 : 0.55;
        const slant = config.heavy ? 6 : 2;
        ctx.strokeStyle = 'rgba(170, 195, 225, 0.55)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let index = 0; index < count; index += 1) {
          const bucket = Math.floor((timeMs * fallSpeed) / 1200);
          const x = particleSeed(index, bucket) * (width + 40) - 20;
          const y =
            ((particleSeed(index, bucket + 7717) + (timeMs * fallSpeed) / 1200) % 1) * height;
          ctx.moveTo(x, y);
          ctx.lineTo(x - slant, y + 10);
        }
        ctx.stroke();
      } else if (config.precipitation === 'snow') {
        const count = 80;
        ctx.fillStyle = 'rgba(245, 248, 252, 0.88)';
        for (let index = 0; index < count; index += 1) {
          const bucket = Math.floor(timeMs / 4000);
          const drift = Math.sin(timeMs / 900 + index) * 9;
          const x = particleSeed(index, bucket) * width + drift;
          const y = ((particleSeed(index, bucket + 3313) + timeMs / 9000) % 1) * height;
          const radius = 1.1 + particleSeed(index, bucket + 77) * 1.1;
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (config.streaks) {
        ctx.strokeStyle = 'rgba(200, 210, 215, 0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let index = 0; index < 22; index += 1) {
          const bucket = Math.floor(timeMs / 2600);
          const y = particleSeed(index, bucket) * height;
          const x = ((particleSeed(index, bucket + 910) + timeMs / 2600) % 1) * (width + 120) - 60;
          ctx.moveTo(x, y);
          ctx.lineTo(x + 34, y - 3);
        }
        ctx.stroke();
      }

      if (config.fog) {
        drawFogBanks(ctx, width, height, timeMs);
      }
      if (config.lightning) {
        drawLightning(ctx, width, height, timeMs);
      }
      ctx.restore();
    },
  };
}

/** Slow-drifting soft fog banks (deterministic per index + time bucket). */
function drawFogBanks(ctx, width, height, timeMs) {
  for (let index = 0; index < 5; index += 1) {
    const bucket = Math.floor(timeMs / 9000);
    const seedX = particleSeed(index, bucket);
    const seedY = particleSeed(index + 40, bucket);
    const x = (seedX + timeMs / 48000 + index * 0.21) % 1.3 - 0.15;
    const y = 0.15 + seedY * 0.7;
    const radius = Math.min(width, height) * (0.22 + particleSeed(index, bucket + 55) * 0.14);
    const gradient = ctx.createRadialGradient(
      x * width,
      y * height,
      radius * 0.15,
      x * width,
      y * height,
      radius,
    );
    gradient.addColorStop(0, 'rgba(205, 212, 216, 0.13)');
    gradient.addColorStop(1, 'rgba(205, 212, 216, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.ellipse(x * width, y * height, radius, radius * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Occasional deterministic sheet-lightning flashes for storms. */
function drawLightning(ctx, width, height, timeMs) {
  const bucket = Math.floor(timeMs / LIGHTNING_PERIOD_MS);
  if (particleSeed(bucket, 991) > 0.42) return;
  const phaseInBucket = (timeMs % LIGHTNING_PERIOD_MS) / LIGHTNING_PERIOD_MS;
  if (phaseInBucket > 0.22) return;
  const intensity = Math.sin((phaseInBucket / 0.22) * Math.PI) * 0.34;
  ctx.fillStyle = `rgba(226, 232, 255, ${intensity.toFixed(3)})`;
  ctx.fillRect(0, 0, width, height);
}
