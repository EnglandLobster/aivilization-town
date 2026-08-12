/**
 * Weather overlay for the living-town canvas (flag-aware).
 *
 * Reads the optional `projection.weather` slice (`{ current, since }`, see
 * `packages/world/src/weather.ts`). When the town-weather switch is off the
 * projection omits the field and `setWeather(null)` disables the layer — no
 * particles, no tint, no errors. Precipitation particles are deterministic
 * functions of (index, time bucket), so frames are stable and replayable.
 */

const TINTS = {
  sunny: { color: 'rgba(255, 236, 170, 0.07)' },
  cloudy: { color: 'rgba(120, 130, 140, 0.14)' },
  windy: { color: 'rgba(150, 165, 175, 0.08)', streaks: true },
  rainy: { color: 'rgba(90, 110, 140, 0.16)', precipitation: 'rain' },
  stormy: { color: 'rgba(50, 60, 90, 0.26)', precipitation: 'rain', heavy: true },
  snowy: { color: 'rgba(220, 228, 238, 0.14)', precipitation: 'snow' },
  foggy: { color: 'rgba(190, 196, 200, 0.22)' },
};

function particleSeed(index, bucket) {
  let hash = (index * 2654435761 + bucket * 40503) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177) >>> 0;
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967295;
}

export function createWeatherLayer() {
  let config = null;

  return {
    /** Accepts `projection.weather` (or `undefined`/`null` when flag-gated off). */
    setWeather(weather) {
      config = weather && TINTS[weather.current] ? TINTS[weather.current] : null;
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
        const count = config.heavy ? 90 : 45;
        const fallSpeed = config.heavy ? 0.9 : 0.55;
        ctx.strokeStyle = 'rgba(170, 195, 225, 0.55)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let index = 0; index < count; index += 1) {
          const bucket = Math.floor((timeMs * fallSpeed) / 1200);
          const x = particleSeed(index, bucket) * (width + 40) - 20;
          const y =
            ((particleSeed(index, bucket + 7717) + (timeMs * fallSpeed) / 1200) % 1) * height;
          ctx.moveTo(x, y);
          ctx.lineTo(x - 2, y + 9);
        }
        ctx.stroke();
      } else if (config.precipitation === 'snow') {
        const count = 55;
        ctx.fillStyle = 'rgba(245, 248, 252, 0.85)';
        for (let index = 0; index < count; index += 1) {
          const bucket = Math.floor(timeMs / 4000);
          const drift = Math.sin(timeMs / 900 + index) * 8;
          const x = particleSeed(index, bucket) * width + drift;
          const y = ((particleSeed(index, bucket + 3313) + timeMs / 9000) % 1) * height;
          ctx.beginPath();
          ctx.arc(x, y, 1.4, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (config.streaks) {
        ctx.strokeStyle = 'rgba(200, 210, 215, 0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let index = 0; index < 14; index += 1) {
          const bucket = Math.floor(timeMs / 2600);
          const y = particleSeed(index, bucket) * height;
          const x = ((particleSeed(index, bucket + 910) + timeMs / 2600) % 1) * (width + 120) - 60;
          ctx.moveTo(x, y);
          ctx.lineTo(x + 34, y - 3);
        }
        ctx.stroke();
      }
      ctx.restore();
    },
  };
}
