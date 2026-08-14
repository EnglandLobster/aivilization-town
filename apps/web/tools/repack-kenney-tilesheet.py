#!/usr/bin/env python3
"""Repack Kenney Tiny Town (CC0) tiles into the living-town tilesheet layout.

The canonical sheet `apps/web/public/ui/assets/tiles.png` is derived from the
Kenney "Tiny Town" asset pack (CC0, see ATTRIBUTION.md next to the sheet).
This script is the reproducible record of that derivation. It preserves the
layout contract consumed by `apps/web/public/ui/map/tilesheet.js`:

  - 256x256 sheet of 16x16 tiles
  - row 0: terrain (grass cols 0-2, path cols 3-4, plaza cols 5-6)
  - rows 1-14: buildings, 2 rows per location band, 3 upgrade levels side by
    side (2x2 tiles each; levels 2-3 are reserved frames for issue #8)
  - row 15: agent walk frames (cols 0-7) and the selection bracket (col 8),
    carried over unchanged from the procedural placeholder sheet produced by
    `tools/generate-tilesheet.mjs`

Usage:

  python3 apps/web/tools/repack-kenney-tilesheet.py \
    --kenney-dir /path/to/extracted/kenney_tiny-town \
    --base apps/web/public/ui/assets/tiles.png   # procedural sheet (agents/selection)
    # writes the result back over --base

Requires Pillow. The Kenney pack is NOT vendored into the repository; download
it from https://kenney.nl/assets/tiny-town (CC0).
"""

import argparse
from PIL import Image

TS = 16

# Building compositions: location band -> [L1, L2, L3]; each level is four
# 16x16 tiles [TL, TR, BL, BR]; a tile is (background tile id, optional
# foreground tile id alpha-composited on top). Tile ids refer to
# Tiles/tile_XXXX.png in the Kenney pack.
BANDS = [
    "town-square",
    "residential-block",
    "school",
    "clinic",
    "restaurant",
    "market",
    "workshop",
]

COMP = {
    "town-square": [
        [(43, None), (43, None), (43, None), (43, 104)],
        [(43, None), (43, 104), (43, None), (43, 83)],
        [(48, None), (49, None), (43, None), (43, 104)],
    ],
    "residential-block": [
        [(72, 92), (72, 92), (72, None), (72, 85)],
        [(73, 92), (73, 92), (73, None), (73, 86)],
        [(96, None), (98, None), (109, None), (109, 89)],
    ],
    "school": [
        [(76, 92), (76, 92), (76, None), (76, 89)],
        [(76, 92), (76, 95), (76, None), (76, 89)],
        [(96, None), (98, None), (102, None), (109, 90)],
    ],
    "clinic": [
        [(76, None), (77, None), (88, None), (89, None)],
        [(76, None), (76, None), (88, None), (90, None)],
        [(96, None), (98, None), (102, None), (89, None)],
    ],
    "restaurant": [
        [(72, 92), (72, 92), (72, None), (86, None)],
        [(72, 92), (72, 92), (84, None), (85, None)],
        [(72, 92), (72, 92), (84, None), (72, 106)],
    ],
    "market": [
        [(52, None), (53, None), (43, 83), (43, 106)],
        [(64, None), (65, None), (43, 83), (43, 107)],
        [(52, None), (53, None), (43, 95), (43, 106)],
    ],
    "workshop": [
        [(48, None), (49, None), (74, None), (48, 105)],
        [(60, None), (61, None), (74, None), (48, 115)],
        [(99, None), (101, None), (74, None), (48, 115)],
    ],
}

# Terrain row: grass cols 0-2, path cols 3-4, plaza cols 5-6.
TERRAIN = [0, 1, 2, 40, 39, 43, 48]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--kenney-dir", required=True, help="extracted kenney_tiny-town directory")
    parser.add_argument("--base", required=True, help="existing tiles.png to overlay onto (updated in place)")
    args = parser.parse_args()

    def tile(n: int) -> Image.Image:
        return Image.open(f"{args.kenney_dir}/Tiles/tile_{n:04d}.png").convert("RGBA")

    def comp(bg: int, fg) -> Image.Image:
        out = tile(bg).copy()
        if fg is not None:
            layer = tile(fg)
            out.paste(layer, (0, 0), layer)
        return out

    base = Image.open(args.base).convert("RGBA")

    for col, n in enumerate(TERRAIN):
        base.paste(tile(n), (col * TS, 0))

    for band, location in enumerate(BANDS):
        row0 = 1 + band * 2
        for level in range(3):
            for i, (bg, fg) in enumerate(COMP[location][level]):
                base.paste(comp(bg, fg), (((level * 2) + (i % 2)) * TS, (row0 + (i // 2)) * TS))

    base.save(args.base)
    print(f"repacked {args.base}")


if __name__ == "__main__":
    main()
