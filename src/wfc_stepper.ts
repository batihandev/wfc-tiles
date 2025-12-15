// src/wfc_stepper.ts
export type TileDef = {
  id: string;
  baseId: string;
  file: string;
  edges: { n: string; e: string; s: string; w: string };
};

export type Variant = TileDef & { rot: 0 | 1 | 2 | 3 };

export type WfcStepperOptions = {
  seed: number;
  allowRotate?: boolean;
  maxRestarts?: number;
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

type Dir = 0 | 1 | 2 | 3; // N,E,S,W
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

function rotateEdges90CW(e: TileDef["edges"]) {
  // CW: N<-W, E<-N, S<-E, W<-S
  return { n: e.w, e: e.n, s: e.e, w: e.s };
}

function buildVariants(tiles: TileDef[], allowRotate: boolean): Variant[] {
  if (!allowRotate) return tiles.map((t) => ({ ...t, rot: 0 as const }));

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

function countBits32(x: number) {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function popLowestBitIndex(x: number) {
  const lsb = x & -x;
  return Math.clz32(lsb) ^ 31;
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

function countDomain(domain: Uint32Array, cell: number, words: number) {
  let total = 0;
  const base = cell * words;
  for (let w = 0; w < words; w++) total += countBits32(domain[base + w]);
  return total;
}

function domainIsEmpty(domain: Uint32Array, cell: number, words: number) {
  const base = cell * words;
  for (let w = 0; w < words; w++) if (domain[base + w] !== 0) return false;
  return true;
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

function getSingleIndex(domain: Uint32Array, cell: number, words: number) {
  const base = cell * words;
  for (let w = 0; w < words; w++) {
    const v = domain[base + w];
    if (v !== 0) {
      const bit = popLowestBitIndex(v);
      return w * 32 + bit;
    }
  }
  return -1;
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
      const bit = popLowestBitIndex(bits);
      bits &= bits - 1;
      options.push(w * 32 + bit);
    }
  }
  return options[(rng() * options.length) | 0];
}

// compat[dir][tile] -> bitset of tiles that can be neighbor in that direction
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
      for (const d of DIRS) {
        if (edge(tiles[a], d) === edge(tiles[b], opposite(d))) {
          compat[d][a][b >>> 5] |= 1 << (b & 31);
        }
      }
    }
  }

  return { compat, words };
}

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
      const bit = popLowestBitIndex(bits);
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

  // randomized scan start reduces directional artifacts
  const start = (rng() * cells) | 0;
  for (let i = 0; i < cells; i++) {
    const cell = (start + i) % cells;
    const c = countDomain(domain, cell, words);
    if (c <= 1) continue;
    if (c < bestCount) {
      bestCount = c;
      bestCell = cell;
      if (bestCount === 2) break;
    }
  }
  return bestCell;
}

export type WfcEvent =
  | { type: "collapse"; cell: number; tile: number }
  | { type: "propagate"; cell: number } // a neighbor cell changed
  | { type: "done" }
  | { type: "restart"; attempt: number }
  | { type: "error"; message: string };

export class WfcStepper {
  readonly gridW: number;
  readonly gridH: number;
  readonly cells: number;

  readonly tiles: Variant[];
  readonly words: number;

  private readonly compat: Uint32Array[][];
  private rng: RNG;

  private attempt = 0;
  private maxRestarts: number;

  // domain bitset per cell
  private domain: Uint32Array;
  private queue: number[] = [];

  // stats
  collapsed = 0;

  constructor(
    baseTiles: TileDef[],
    gridW: number,
    gridH: number,
    opts: WfcStepperOptions
  ) {
    this.gridW = gridW;
    this.gridH = gridH;
    this.cells = gridW * gridH;

    this.tiles = buildVariants(baseTiles, !!opts.allowRotate);
    const { compat, words } = buildCompat(this.tiles);
    this.compat = compat;
    this.words = words;

    this.maxRestarts = opts.maxRestarts ?? 40;

    this.rng = mulberry32(opts.seed >>> 0);
    this.domain = new Uint32Array(this.cells * this.words);
    this.resetDomain();
  }

  private resetDomain() {
    for (let c = 0; c < this.cells; c++) setAll(this.domain, c, this.words);
    maskUnusedHighBits(this.domain, this.cells, this.words, this.tiles.length);
    this.queue.length = 0;
    this.collapsed = 0;
  }

  // Expose entropy for visualization (count of possible tiles)
  entropy(cell: number) {
    return countDomain(this.domain, cell, this.words);
  }

  // If collapsed, returns tile index else -1
  collapsedTile(cell: number) {
    return this.entropy(cell) === 1
      ? getSingleIndex(this.domain, cell, this.words)
      : -1;
  }
  get queueSize() {
    return this.queue.length;
  }
  // Produce final result (only valid after done)
  buildResult(): Uint16Array {
    const out = new Uint16Array(this.cells);
    for (let c = 0; c < this.cells; c++)
      out[c] = getSingleIndex(this.domain, c, this.words);
    return out;
  }

  // Advance a bounded amount of work; returns emitted events
  step(maxCollapses: number, maxPropagations: number): WfcEvent[] {
    const events: WfcEvent[] = [];

    for (let i = 0; i < maxCollapses; i++) {
      // If there’s pending propagation, consume it first
      let propBudget = maxPropagations;
      while (this.queue.length > 0 && propBudget-- > 0) {
        const cell = this.queue.pop()!;
        const x = cell % this.gridW;
        const y = (cell / this.gridW) | 0;

        for (const d of DIRS) {
          const nb = neighborIndex(x, y, this.gridW, this.gridH, d);
          if (nb < 0) continue;

          const allowed = unionCompatForCell(
            this.domain,
            cell,
            this.words,
            this.compat[d]
          );
          const changed = domainAndInPlace(
            this.domain,
            nb,
            this.words,
            allowed
          );
          if (changed) {
            events.push({ type: "propagate", cell: nb });
            if (domainIsEmpty(this.domain, nb, this.words)) {
              // contradiction -> restart
              this.attempt++;
              if (this.attempt > this.maxRestarts) {
                events.push({
                  type: "error",
                  message: `WFC failed after ${this.maxRestarts} restarts.`,
                });
                return events;
              }
              this.resetDomain();
              events.push({ type: "restart", attempt: this.attempt });
              return events;
            }
            this.queue.push(nb);
          }
        }
      }

      // If still propagating, stop collapses this tick to avoid starving propagation
      if (this.queue.length > 0) break;

      const cell = findMinEntropyCell(
        this.domain,
        this.cells,
        this.words,
        this.rng
      );
      if (cell === -1) {
        events.push({ type: "done" });
        return events;
      }

      const chosen = pickTileFromDomain(
        this.domain,
        cell,
        this.words,
        this.rng
      );
      restrictToTile(this.domain, cell, this.words, chosen);
      this.collapsed++;

      events.push({ type: "collapse", cell, tile: chosen });

      // start propagation from this collapsed cell
      this.queue.push(cell);
    }

    return events;
  }
}
