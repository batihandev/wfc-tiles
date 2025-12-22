// tools/gen-tileset.ts (for example)
import * as fs from "node:fs";
import * as path from "node:path";

type EdgeCode = string;

type TileDef = {
  id: string;
  baseId: string;
  file: string;
  edges: { n: EdgeCode; e: EdgeCode; s: EdgeCode; w: EdgeCode };
  weight?: number;
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
 *  - [DGR]{12}
 *  - [DGR]{12}\d+
 * Examples:
 *  GGGDDDGDDGDD
 *  GGGDDDGDDGDD2
 *  GGGDDDGDDGDD10
 */
function splitVariant(id: string): { baseId: string; variantSuffix: string } {
  const m = id.match(/^([DGR]{12})(\d+)?$/i);
  if (!m) {
    throw new Error(
      `Invalid tile id "${id}". Expected 12 chars of D/G/R, optionally followed by digits (e.g. GGGDDDGDDGDD2).`
    );
  }
  return { baseId: m[1].toUpperCase(), variantSuffix: m[2] ?? "" };
}

function parseEdgesFromBaseId(baseId: string) {
  // baseId is guaranteed [DGR]{12}
  return {
    n: baseId.slice(0, 3),
    e: baseId.slice(3, 6),
    s: baseId.slice(6, 9),
    w: baseId.slice(9, 12),
  };
}

// --- weight heuristics -------------------------------------------------

function countChar(s: string, ch: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s[i] === ch) n++;
  return n;
}

/**
 * Compute a heuristic weight from the 12-char baseId.
 *
 * Intuition:
 *  - More G => more common (large grass areas)
 *  - More D => less common (paths / dirt rarer than grass)
 *  - Clamp to [0.2, 30] so extremes do not explode
 */
function computeWeight(baseId: string): number {
  const g = countChar(baseId, "G");
  const d = countChar(baseId, "D");
  const r = countChar(baseId, "R");
  // Start neutral
  let w = 1;

  // Reward grass: each G increases weight a bit
  w *= 1 + g * 0.15;

  w /= 1 + d * 0.2;

  w /= 1 + r * 0.4;

  if (r === 3) {
    // Rare road ends.
    w *= 0.3;
  }
  if (r === 12) {
    // crossroads are super rare
    w *= 0.1;
  }

  if (w < 0.2) w = 0.02;
  if (w > 30) w = 60;

  // Optional: keep JSON small
  return Number(w.toFixed(3));
}

// -----------------------------------------------------------------------

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
    const weight = computeWeight(baseId);

    return {
      id,
      baseId,
      file: path.posix.join("tiles", filename).replace(/\\/g, "/"),
      edges,
      weight,
    };
  });

  const tileset: Tileset = {
    meta: {
      tileSize: 16,
      edgeCharsPerSide: 3,
      encoding:
        "filename baseId encodes edges clockwise N-E-S-W, 3 chars each (12 total). Trailing digits are variants. Weights derived from G/D counts in baseId.",
      tileCount: tiles.length,
    },
    tiles,
  };

  fs.writeFileSync(outFile, JSON.stringify(tileset, null, 2), "utf8");
  console.log(`Wrote ${outFile} (${tiles.length} tiles)`);
}

main();
