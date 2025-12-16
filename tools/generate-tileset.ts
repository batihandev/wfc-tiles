import * as fs from "node:fs";
import * as path from "node:path";

type TileDef = {
  id: string;
  baseId: string;
  file: string;
  edges: { n: string; e: string; s: string; w: string };
  weight?: number; // NEW
};

type Tileset = {
  meta: {
    tileSize: number;
    edgeCharsPerSide: number;
    encoding: string;
    tileCount: number;
  };
  tiles: TileDef[];
};

function stripExt(name: string) {
  return name.replace(/\.[^.]+$/, "");
}

/**
 * Accept:
 *  - [DG]{12}
 *  - [DG]{12}\d+
 * Examples:
 *  GGGDDDGDDGDD
 *  GGGDDDGDDGDD2
 *  GGGDDDGDDGDD10
 */
function splitVariant(id: string): { baseId: string; variantSuffix: string } {
  const m = id.match(/^([DG]{12})(\d+)?$/i);
  if (!m) {
    throw new Error(
      `Invalid tile id "${id}". Expected 12 chars of D/G, optionally followed by digits (e.g. GGGDDDGDDGDD2).`
    );
  }
  return { baseId: m[1].toUpperCase(), variantSuffix: m[2] ?? "" };
}

function parseEdgesFromBaseId(baseId: string) {
  // baseId is guaranteed [DG]{12}
  return {
    n: baseId.slice(0, 3),
    e: baseId.slice(3, 6),
    s: baseId.slice(6, 9),
    w: baseId.slice(9, 12),
  };
}

function main() {
  const root = process.cwd();
  const tilesDir = path.join(root, "tiles");
  const outFile = path.join(root, "tileset.json");

  if (!fs.existsSync(tilesDir)) {
    throw new Error(`Missing tiles dir: ${tilesDir}`);
  }

  const files = fs
    .readdirSync(tilesDir)
    .filter((f) => f.toLowerCase().endsWith(".png"))
    .sort((a, b) => a.localeCompare(b));

  if (files.length === 0) {
    throw new Error("No .png tiles found in /tiles");
  }

  const tiles: TileDef[] = files.map((filename) => {
    const id = stripExt(filename);
    const { baseId } = splitVariant(id);
    const edges = parseEdgesFromBaseId(baseId);

    return {
      id,
      baseId,
      file: path.posix.join("tiles", filename),
      edges,
      weight: 1, // NEW default
    };
  });

  const tileset: Tileset = {
    meta: {
      tileSize: 16,
      edgeCharsPerSide: 3,
      encoding:
        "filename baseId encodes edges clockwise N-E-S-W, 3 chars each (12 total). Trailing digits are variants.",
      tileCount: tiles.length,
    },
    tiles,
  };

  fs.writeFileSync(outFile, JSON.stringify(tileset, null, 2), "utf8");
  console.log(`Wrote ${outFile} (${tiles.length} tiles)`);
}

main();
