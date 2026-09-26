import { Assets, Rectangle, Texture } from 'pixi.js';

/** Original CC0 sheets; frames are shared across all map sprites, without resampling. */
const citizensUrl = new URL('./assets/kenney-characters.png', import.meta.url).href;
const cityUrl = new URL('./assets/kenney-modern-city.png', import.meta.url).href;
let preparation: Promise<void> | undefined;
export async function loadTownArt() {
  // These known PNGs need neither format probes nor blob workers, which strict CSP forbids.
  await (preparation ??= Assets.init({
    skipDetections: true,
    texturePreference: { format: ['png'] },
    preferences: { preferWorkers: false },
  }));
  const [atlas, citizens] = await Promise.all([
    Assets.load<Texture>(cityUrl),
    Assets.load<Texture>(citizensUrl),
  ]);
  citizens.source.scaleMode = 'nearest';
  const characters = Array.from(
    { length: 14 },
    (_, i) =>
      new Texture({
        source: citizens.source,
        frame: new Rectangle((i % 2) * 17, (5 + Math.floor(i / 2)) * 17, 16, 16),
      }),
  );
  atlas.source.scaleMode = 'nearest';
  const water = new Texture({
    source: atlas.source,
    frame: new Rectangle(27 * 16, 4 * 16 + 5, 16, 11),
  });
  const frames = new Map<string, Texture>();
  return {
    characters,
    water,
    tile(column: number, row: number, columns = 1, rows = 1): Texture {
      const key = `${column},${row},${columns},${rows}`;
      let frame = frames.get(key);
      if (!frame) {
        frame = new Texture({
          source: atlas.source,
          frame: new Rectangle(column * 16, row * 16, columns * 16, rows * 16),
        });
        frames.set(key, frame);
      }
      return frame;
    },
    destroy() {
      frames.forEach((frame) => frame.destroy());
      frames.clear();
      water.destroy();
      characters.forEach((frame) => frame.destroy());
    },
  };
}
export type TownArt = Awaited<ReturnType<typeof loadTownArt>>;
