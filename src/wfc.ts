// src/wfc.ts
export type TileDef = {
  id: string;
  baseId: string;
  file: string;
  edges: { n: string; e: string; s: string; w: string };
};

export type WfcOptions = {
  seed: number;
  allowRotate?: boolean; // if true, generates rotated variants of tiles
  maxRestarts?: number; // restart attempts on contradiction
};

type RNG = () => number;

function mulberry32(seed: number): RNG {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function pickRandomIndex(rng: RNG, indices: number[]) {
  return indices[(rng() * indices.length) | 0];
}

function popLowestBit(x: number) {
  // returns bit index [0..31] for lowest set bit
  const lsb = x & -x;
  return Math.clz32(lsb) ^ 31;
}

type Variant = TileDef & { rot: 0 | 1 | 2 | 3 }; // rotation count * 90deg

function rotateEdges90CW(e: TileDef["edges"]) {
  // CW: N <- W, E <- N, S <- E, W <- S
  return { n: e.w, e: e.n, s: e.e, w: e.s };
}

function buildVariants(tiles: TileDef[], allowRotate: boolean): Variant[] {
  if (!allowRotate) return tiles.map((t) => ({ ...t, rot: 0 as const }));

  // Create 0/90/180/270 variants, but dedupe by (file + edges) so you don’t explode counts for symmetric tiles.
  const out: Variant[] = [];
  const seen = new Set<string>();

  for (const t of tiles) {
    let edges = t.edges;
    for (let r = 0 as 0 | 1 | 2 | 3; r < 4; r = (r + 1) as any) {
      const key = `${t.file}|${edges.n}${edges.e}${edges.s}${edges.w}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({
          ...t,
          id: `${t.id}__r${r}`,
          baseId: t.baseId,
          edges,
          rot: r,
        });
      }
      edges = rotateEdges90CW(edges);
    }
  }
  return out;
}

function wordCount(tileCount: number) {
  return (tileCount + 31) >>> 5;
}

function setAll(domain: Uint32Array, cell: number, words: number) {
  const base = cell * words;
  for (let w = 0; w < words; w++) domain[base + w] = 0xffffffff;
}

function maskUnusedHighBits(
  domain: Uint32Array,
  cells: number,
  words: number,
  tileCount: number
) {
  const extra = words * 32 - tileCount;
  if (extra <= 0) return;
  const lastMask = 0xffffffff >>> extra;
  for (let c = 0; c < cells; c++) {
    domain[c * words + (words - 1)] &= lastMask;
  }
}

function cloneDomain(domain: Uint32Array) {
  return new Uint32Array(domain);
}

function countBits32(x: number) {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function countDomain(domain: Uint32Array, cell: number, words: number) {
  let total = 0;
  const base = cell * words;
  for (let w = 0; w < words; w++) total += countBits32(domain[base + w]);
  return total;
}

function isSingle(domain: Uint32Array, cell: number, words: number) {
  return countDomain(domain, cell, words) === 1;
}

function getSingleIndex(domain: Uint32Array, cell: number, words: number) {
  const base = cell * words;
  for (let w = 0; w < words; w++) {
    const v = domain[base + w];
    if (v !== 0) {
      const bit = popLowestBit(v);
      return w * 32 + bit;
    }
  }
  return -1;
}

function restrictToTile(
  domain: Uint32Array,
  cell: number,
  words: number,
  tileIdx: number
) {
  const base = cell * words;
  for (let w = 0; w < words; w++) domain[base + w] = 0;
  domain[base + (tileIdx >>> 5)] = 1 << (tileIdx & 31);
}

function domainsEqual(
  a: Uint32Array,
  b: Uint32Array,
  cell: number,
  words: number
) {
  const base = cell * words;
  for (let w = 0; w < words; w++) if (a[base + w] !== b[base + w]) return false;
  return true;
}

function domainAndInPlace(
  domain: Uint32Array,
  cell: number,
  words: number,
  mask: Uint32Array
) {
  const base = cell * words;
  let changed = false;
  for (let w = 0; w < words; w++) {
    const prev = domain[base + w];
    const next = prev & mask[w];
    if (next !== prev) {
      domain[base + w] = next;
      changed = true;
    }
  }
  return changed;
}

function domainIsEmpty(domain: Uint32Array, cell: number, words: number) {
  const base = cell * words;
  for (let w = 0; w < words; w++) if (domain[base + w] !== 0) return false;
  return true;
}

type Dir = 0 | 1 | 2 | 3; // 0=N,1=E,2=S,3=W
const DIRS: Dir[] = [0, 1, 2, 3];

function opposite(d: Dir): Dir {
  return ((d + 2) & 3) as Dir;
}

function neighborIndex(x: number, y: number, w: number, h: number, d: Dir) {
  if (d === 0) return y > 0 ? (y - 1) * w + x : -1;
  if (d === 1) return x + 1 < w ? y * w + (x + 1) : -1;
  if (d === 2) return y + 1 < h ? (y + 1) * w + x : -1;
  return x > 0 ? y * w + (x - 1) : -1;
}

// Precompute allowed neighbor masks: compat[d][tile] = bitset mask of tiles that can sit in direction d of tile
function buildCompat(tiles: Variant[]) {
  const n = tiles.length;
  const words = wordCount(n);

  const compat: Uint32Array[][] = Array.from({ length: 4 }, () =>
    Array.from({ length: n }, () => new Uint32Array(words))
  );

  const edge = (t: Variant, d: Dir) => {
    if (d === 0) return t.edges.n;
    if (d === 1) return t.edges.e;
    if (d === 2) return t.edges.s;
    return t.edges.w;
  };

  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      // b is neighbor of a in direction d if edge(a,d) == edge(b,opposite(d))
      for (const d of DIRS) {
        if (edge(tiles[a], d) === edge(tiles[b], opposite(d))) {
          compat[d][a][b >>> 5] |= 1 << (b & 31);
        }
      }
    }
  }

  return { compat, words };
}

// Build union of compat masks for all tiles currently possible in `cell`
function unionCompatForCell(
  domain: Uint32Array,
  cell: number,
  words: number,
  compatDir: Uint32Array[]
) {
  const out = new Uint32Array(words);
  const base = cell * words;

  for (let w = 0; w < words; w++) {
    let bits = domain[base + w];
    while (bits !== 0) {
      const bit = popLowestBit(bits);
      bits &= bits - 1;
      const tile = w * 32 + bit;
      const cm = compatDir[tile];
      for (let k = 0; k < words; k++) out[k] |= cm[k];
    }
  }
  return out;
}

function findMinEntropyCell(
  domain: Uint32Array,
  cells: number,
  words: number,
  rng: RNG
) {
  let bestCount = Infinity;
  let bestCell = -1;

  // Tie-break by random jitter to avoid directional bias
  const start = (rng() * cells) | 0;

  for (let i = 0; i < cells; i++) {
    const cell = (start + i) % cells;
    const c = countDomain(domain, cell, words);
    if (c <= 1) continue;
    if (c < bestCount) {
      bestCount = c;
      bestCell = cell;
      if (bestCount === 2) break; // decent early exit
    }
  }

  return bestCell;
}

function pickTileFromDomain(
  domain: Uint32Array,
  cell: number,
  words: number,
  rng: RNG
) {
  const options: number[] = [];
  const base = cell * words;

  for (let w = 0; w < words; w++) {
    let bits = domain[base + w];
    while (bits !== 0) {
      const bit = popLowestBit(bits);
      bits &= bits - 1;
      options.push(w * 32 + bit);
    }
  }

  return pickRandomIndex(rng, options);
}

function propagate(
  domain: Uint32Array,
  gridW: number,
  gridH: number,
  words: number,
  compat: Uint32Array[][],
  queue: number[]
) {
  while (queue.length > 0) {
    const cell = queue.pop()!;
    const x = cell % gridW;
    const y = (cell / gridW) | 0;

    for (const d of DIRS) {
      const nb = neighborIndex(x, y, gridW, gridH, d);
      if (nb < 0) continue;

      // allowed tiles for neighbor are union over current domain tiles of compat[d][tile]
      const allowed = unionCompatForCell(domain, cell, words, compat[d]);
      const changed = domainAndInPlace(domain, nb, words, allowed);
      if (changed) {
        if (domainIsEmpty(domain, nb, words)) return false; // contradiction
        queue.push(nb);
      }
    }
  }
  return true;
}

export function wfcGenerate(
  baseTiles: TileDef[],
  gridW: number,
  gridH: number,
  opts: WfcOptions
): { tiles: Variant[]; result: Uint16Array } {
  const allowRotate = !!opts.allowRotate;
  const maxRestarts = opts.maxRestarts ?? 30;

  const variants = buildVariants(baseTiles, allowRotate);
  const { compat, words } = buildCompat(variants);

  const cells = gridW * gridH;

  for (let attempt = 0; attempt < maxRestarts; attempt++) {
    const rng = mulberry32((opts.seed + attempt * 1013) >>> 0);

    const domain = new Uint32Array(cells * words);
    for (let c = 0; c < cells; c++) setAll(domain, c, words);
    maskUnusedHighBits(domain, cells, words, variants.length);

    const queue: number[] = [];

    // Main loop: collapse -> propagate until all cells resolved
    while (true) {
      const cell = findMinEntropyCell(domain, cells, words, rng);
      if (cell === -1) {
        // all cells have entropy 1
        const out = new Uint16Array(cells);
        for (let c = 0; c < cells; c++)
          out[c] = getSingleIndex(domain, c, words);
        return { tiles: variants, result: out };
      }

      const chosen = pickTileFromDomain(domain, cell, words, rng);

      // Save previous domain snapshot for this cell only (cheap local backtracking is hard);
      // We rely on restart-on-contradiction for simplicity and robustness.
      restrictToTile(domain, cell, words, chosen);

      queue.push(cell);
      const ok = propagate(domain, gridW, gridH, words, compat, queue);
      if (!ok) break; // restart
    }
  }

  throw new Error(
    `WFC failed after ${maxRestarts} restarts. Tileset likely too restrictive (or needs rotations / more tiles).`
  );
}
