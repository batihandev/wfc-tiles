// src/tools/validate-tileset.ts
import type { TilesetV2, Dir } from "../components/types";

export function validateTileset(tileset: TilesetV2) {
  const tiles = tileset.tiles;
  const keysByDir: Record<Dir, Set<string>> = {
    n: new Set(),
    e: new Set(),
    s: new Set(),
    w: new Set(),
  };

  tiles.forEach((tile) => {
    (["n", "e", "s", "w"] as Dir[]).forEach((dir) => {
      tile.edges[dir].forEach((rule) => keysByDir[dir].add(rule.key));
    });
  });

  const errors: string[] = [];
  const check = (d1: Dir, d2: Dir, l1: string, l2: string) => {
    keysByDir[d1].forEach((key) => {
      if (!keysByDir[d2].has(key)) {
        errors.push(
          `Key "${key}" on ${l1} has no matching connection on ${l2}.`
        );
      }
    });
  };

  check("n", "s", "NORTH", "SOUTH");
  check("s", "n", "SOUTH", "NORTH");
  check("e", "w", "EAST", "WEST");
  check("w", "e", "WEST", "EAST");

  return { ok: errors.length === 0, errors };
}
