# Town pixel artwork

All files in this directory are original, unmodified Kenney image sheets, licensed under **CC0 1.0**.
They may be used in personal, educational and commercial projects. The original license notices
are included alongside the sheets. Attribution is voluntary and is also linked from the map.

| File                     | Source                                                                      | Original file                               |
| ------------------------ | --------------------------------------------------------------------------- | ------------------------------------------- |
| `kenney-modern-city.png` | [Roguelike Modern City 2.0](https://kenney.nl/assets/roguelike-modern-city) | `Tilemap/tilemap_packed.png`                |
| `kenney-characters.png`  | [Roguelike Characters 2.0](https://kenney.nl/assets/roguelike-characters)   | `Spritesheet/roguelikeChar_transparent.png` |

Retrieved from the author's download archives on 2026-09-25:

- [Modern City archive](https://kenney.nl/media/pages/assets/roguelike-modern-city/0ff3dfff2b-1677694743/kenney_roguelike-modern-city.zip)
- [Characters archive](https://kenney.nl/media/pages/assets/roguelike-characters/53ffff4133-1729196490/kenney_roguelike-characters.zip)
- [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)

`townArt.ts` selects frames without altering the originals. `townBuildings.ts` composes those frames
into visual representations of authoritative locations. Buildings and street furniture do not
create simulation entities. Medical identification and map overlays are application graphics.
Vite fingerprints and bundles the sheets; the running town uses only same-origin asset requests.
