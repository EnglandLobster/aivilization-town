import { Container, Graphics, Sprite, NineSliceSprite } from 'pixi.js';
import type { Texture } from 'pixi.js';
import type { Location } from '../model';
import type { TownArt } from './townArt';

export const TILE = 24;
export function stamp(parent: Container, texture: Texture, x: number, y: number, scale = 1.5) {
  const sprite = new Sprite(texture);
  sprite.position.set(Math.round(x), Math.round(y));
  sprite.scale.set(scale);
  parent.addChild(sprite);
  return sprite;
}
/** Compose the artist's wall/roof/window tiles; these are visual pieces of one location. */
function building(
  parent: Container,
  art: TownArt,
  x: number,
  foot: number,
  columns: number,
  roof: number,
  brick: number,
  floors = 3,
  canopy?: 'green' | 'orange',
) {
  const roofRows = 3,
    top = foot - (roofRows + floors) * TILE;
  parent.addChild(
    new Graphics()
      .rect(x + 7, top + 11, columns * TILE, (roofRows + floors) * TILE)
      .fill({ color: 0x263a34, alpha: 0.17 }),
  );
  const roofSprite = new NineSliceSprite({
    texture: art.tile(roof, 0, 2, 2),
    leftWidth: 3,
    rightWidth: 3,
    topHeight: 3,
    bottomHeight: 3,
    width: columns * TILE,
    height: roofRows * TILE,
  });
  roofSprite.position.set(x, top);
  parent.addChild(roofSprite);
  for (let row = 0; row < floors; row++)
    for (let col = 0; col < columns; col++)
      stamp(
        parent,
        art.tile(brick + (col === 0 ? 0 : col === columns - 1 ? 3 : 2), row === floors - 1 ? 8 : 5),
        x + col * TILE,
        top + (roofRows + row) * TILE,
      );
  for (let col = 1; col < columns - 1; col += 2)
    stamp(
      parent,
      art.tile(brick === 4 ? 25 : 24, brick === 4 ? 19 : 16),
      x + col * TILE,
      top + roofRows * TILE + 6,
    );
  stamp(parent, art.tile(27, 15, 1, 2), x + Math.floor(columns / 2) * TILE, foot - TILE * 2);
  stamp(parent, art.tile(25, 14), x + TILE * (columns - 2), top + TILE);
  stamp(parent, art.tile(27, 14), x + TILE, top + TILE);
  if (canopy) {
    const base = canopy === 'green' ? 23 : 27;
    for (let col = 0; col < columns; col++) {
      const tx = base + (col === 0 ? 0 : col === columns - 1 ? 3 : 1);
      stamp(parent, art.tile(tx, 9, 1, 2), x + col * TILE, foot - TILE * 2.15);
    }
  }
  return top;
}
export function createPlaceBuilding(location: Location, art: TownArt) {
  const root = new Container();
  let top = -144;
  const kind = location.kind;
  if (kind === 'social') {
    // Fountain, benches and planting use original atlas pieces.
    top = -70;
    stamp(root, art.tile(26, 4, 3, 3), -54, -70, 2.25);
    for (const x of [-110, 70]) {
      stamp(root, art.tile(16, 15, 3, 1), x, 33);
      stamp(root, art.tile(34, 10, 1, 2), x + 20, -113);
    }
  } else if (kind === 'residence') {
    top = building(root, art, -138, 15, 5, 0, 0, 3);
    building(root, art, 18, 15, 5, 24, 8, 3);
    // Two small gardens belonging to the same residential block.
    for (const x of [-120, 42])
      for (let i = 0; i < 4; i++) stamp(root, art.tile(20, 14), x + i * TILE, 52);
  } else if (kind === 'market') {
    top = building(root, art, -84, -6, 7, 0, 0, 2, 'green');
    stamp(root, art.tile(34, 14, 1, 2), -92, 28, 2);
    stamp(root, art.tile(35, 14, 1, 2), -30, 28, 2);
    stamp(root, art.tile(36, 14, 1, 2), 32, 28, 2);
    for (let i = 0; i < 4; i++) stamp(root, art.tile(10 + (i % 2), 18), -46 + i * 28, 0);
  } else if (kind === 'food') {
    top = building(root, art, -84, -2, 7, 0, 0, 3, 'orange');
    for (const x of [-74, -5, 64]) stamp(root, art.tile(16, 15, 3, 1), x - 16, 44);
    stamp(root, art.tile(35, 14, 1, 2), 88, 14, 1.5);
  } else if (kind === 'education') {
    top = building(root, art, -108, 20, 9, 24, 8, 4);
    stamp(root, art.tile(8, 16, 1, 3), 122, -44);
    for (let i = 0; i < 3; i++) stamp(root, art.tile(31, 12), -92 + i * 76, 47);
  } else if (kind === 'healthcare') {
    top = building(root, art, -96, 14, 8, 16, 4, 3);
    // A small medical sign identifies the authoritative healthcare location.
    const sign = new Graphics().rect(-13, top + 22, 26, 26).fill(0xf0f1dd);
    sign
      .rect(-4, top + 26, 8, 18)
      .rect(-9, top + 31, 18, 8)
      .fill(0xc27262);
    root.addChild(sign);
    stamp(root, art.tile(9, 17, 1, 2), -115, 4);
  } else {
    top = building(root, art, -108, 18, 9, 8, 4, 3);
    stamp(root, art.tile(23, 14), 55, top + 23, 2);
    stamp(root, art.tile(27, 14), 6, top + 27, 2);
    for (const x of [-96, -64, 74]) {
      stamp(root, art.tile(9, 16), x, 47);
      stamp(root, art.tile(13, 17), x + 16, 38);
    }
  }
  return { root, top };
}
