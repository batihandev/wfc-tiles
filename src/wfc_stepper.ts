// src/wfc_stepper.ts
export type TileDef = {
  id: string;
  baseId: string;
  file: string;
  edges: { n: string; e: string; s: string; w: string };
  weight?: number; // default 1
};

export type Variant = TileDef & { rot: 0 | 1 | 2 | 3 };

export type WfcStepperOptions = {
  seed: number;
  allowRotate?: boolean;
  maxRestarts?: number;

  // Macro bias: seed 3–4 big grass regions before WFC
  macroGrass?: {
    enabled?: boolean;

    // If omitted: auto (3 for small maps, 4 for larger)
    continents?: number;

    // Radius range as fraction of min(gridW, gridH)
    radiusMinFrac?: number; // default 0.14
    radiusMaxFrac?: number; // default 0.22

    // Thresholds on G-count in baseId (12 chars total)
    coreMinG?: number; // default 10 (very grassy)
    rimMinG?: number; // default 8  (moderately grassy)
  };
};

type RNG = () => number;

function mulberry32(seed: number): RNG {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (t >>> 14)) >>> 0) / 4294967296;
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

function pickTileFromDomainWeighted(
  domain: Uint32Array,
  cell: number,
  words: number,
  tiles: Variant[],
  rng: RNG
) {
  const base = cell * words;

  // First pass: compute total weight of available tiles
  let total = 0;
  for (let w = 0; w < words; w++) {
    let bits = domain[base + w];
    while (bits !== 0) {
      const bit = popLowestBitIndex(bits);
      bits &= bits - 1;
      const idx = w * 32 + bit;

      const wt = tiles[idx]?.weight ?? 1;
      if (Number.isFinite(wt) && wt > 0) total += wt;
    }
  }

  // Fallback: if everything is 0-weight, revert to uniform
  if (!(total > 0)) {
    return pickTileFromDomain(domain, cell, words, rng);
  }

  // Second pass: roll and select
  let r = rng() * total;
  for (let w = 0; w < words; w++) {
    let bits = domain[base + w];
    while (bits !== 0) {
      const bit = popLowestBitIndex(bits);
      bits &= bits - 1;
      const idx = w * 32 + bit;

      const wt = tiles[idx]?.weight ?? 1;
      if (!(Number.isFinite(wt) && wt > 0)) continue;

      r -= wt;
      if (r <= 0) return idx;
    }
  }

  // Numerical edge case: return last valid tile found
  for (let w = words - 1; w >= 0; w--) {
    let bits = domain[base + w];
    while (bits !== 0) {
      const bit = popLowestBitIndex(bits);
      bits &= bits - 1;
      return w * 32 + bit;
    }
  }

  return -1;
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

/**
 * Allocation-free: writes union(compatDir[tile]) for all tiles in `cell` domain into `out`.
 */
function unionCompatForCellInto(
  out: Uint32Array,
  domain: Uint32Array,
  cell: number,
  words: number,
  compatDir: Uint32Array[]
) {
  // reset out
  for (let k = 0; k < words; k++) out[k] = 0;

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

// ---------- Macro grass bias helpers ----------
function countChar(s: string, ch: string) {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s[i] === ch) n++;
  return n;
}

function buildMaskForMinG(tiles: Variant[], words: number, minG: number) {
  const mask = new Uint32Array(words);
  for (let i = 0; i < tiles.length; i++) {
    const baseId = (tiles[i].baseId ?? "").toUpperCase();
    const g = countChar(baseId, "G");
    if (g >= minG) {
      mask[i >>> 5] |= 1 << (i & 31);
    }
  }
  return mask;
}

// Intersect cell domain with mask, but refuse if it would become empty.
function intersectCellWithMask(
  domain: Uint32Array,
  cell: number,
  words: number,
  mask: Uint32Array
) {
  const base = cell * words;

  // check emptiness without mutating
  let any = 0;
  for (let w = 0; w < words; w++) any |= domain[base + w] & mask[w];
  if (any === 0) return false;

  // apply
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

  // prevent duplicate queue entries
  private inQueue: Uint8Array;

  // NEW: reusable buffer for allowed-neighbor bitset
  private allowedScratch: Uint32Array;

  // stats
  collapsed = 0;

  // macro bias config & masks
  private macro?: Required<NonNullable<WfcStepperOptions["macroGrass"]>>;
  private coreGrassMask?: Uint32Array;
  private rimGrassMask?: Uint32Array;

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

    this.inQueue = new Uint8Array(this.cells);
    this.allowedScratch = new Uint32Array(this.words);

    const m = opts.macroGrass;
    this.macro =
      m?.enabled === false
        ? undefined
        : {
            enabled: m?.enabled ?? true,
            continents:
              m?.continents ??
              (this.cells >= 128 * 128 ? 4 : this.cells >= 64 * 64 ? 3 : 2),
            radiusMinFrac: m?.radiusMinFrac ?? 0.14,
            radiusMaxFrac: m?.radiusMaxFrac ?? 0.22,
            coreMinG: m?.coreMinG ?? 10,
            rimMinG: m?.rimMinG ?? 8,
          };

    if (this.macro?.enabled) {
      this.coreGrassMask = buildMaskForMinG(
        this.tiles,
        this.words,
        this.macro.coreMinG
      );
      this.rimGrassMask = buildMaskForMinG(
        this.tiles,
        this.words,
        this.macro.rimMinG
      );
    }

    this.resetDomain();
  }

  // deduped enqueue
  private enqueue(cell: number) {
    if (this.inQueue[cell]) return;
    this.inQueue[cell] = 1;
    this.queue.push(cell);
  }

  private applyMacroGrassBias() {
    if (!this.macro?.enabled) return;
    if (!this.coreGrassMask || !this.rimGrassMask) return;

    // Ensure rim mask has something
    let rimAny = 0;
    let coreAny = 0;
    for (let w = 0; w < this.words; w++) {
      rimAny |= this.rimGrassMask[w];
      coreAny |= this.coreGrassMask[w];
    }
    if (rimAny === 0) return;

    const minDim = Math.min(this.gridW, this.gridH);

    const k = Math.max(1, this.macro.continents | 0);
    const rMin = Math.max(2, Math.floor(minDim * this.macro.radiusMinFrac));
    const rMax = Math.max(
      rMin + 1,
      Math.floor(minDim * this.macro.radiusMaxFrac)
    );

    for (let i = 0; i < k; i++) {
      const cx = (this.rng() * this.gridW) | 0;
      const cy = (this.rng() * this.gridH) | 0;
      const r = rMin + ((this.rng() * (rMax - rMin + 1)) | 0);

      const r2 = r * r;
      const coreR = Math.max(1, Math.floor(r * 0.85));
      const core2 = coreR * coreR;

      const x0 = Math.max(0, cx - r);
      const x1 = Math.min(this.gridW - 1, cx + r);
      const y0 = Math.max(0, cy - r);
      const y1 = Math.min(this.gridH - 1, cy + r);

      for (let y = y0; y <= y1; y++) {
        const dy = y - cy;
        for (let x = x0; x <= x1; x++) {
          const dx = x - cx;
          const d2 = dx * dx + dy * dy;
          if (d2 > r2) continue;

          const cell = y * this.gridW + x;

          // Core = stricter mask (if available), rim = looser mask
          const mask =
            d2 <= core2 && coreAny !== 0
              ? this.coreGrassMask
              : this.rimGrassMask;

          const changed = intersectCellWithMask(
            this.domain,
            cell,
            this.words,
            mask
          );

          if (changed) this.enqueue(cell);
        }
      }
    }
  }

  private resetDomain() {
    for (let c = 0; c < this.cells; c++) setAll(this.domain, c, this.words);
    maskUnusedHighBits(this.domain, this.cells, this.words, this.tiles.length);

    this.queue.length = 0;
    this.inQueue.fill(0);
    this.collapsed = 0;

    // Macro bias seeding
    this.applyMacroGrassBias();
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
        this.inQueue[cell] = 0; // allow it to be re-enqueued later if needed

        const x = cell % this.gridW;
        const y = (cell / this.gridW) | 0;

        for (const d of DIRS) {
          const nb = neighborIndex(x, y, this.gridW, this.gridH, d);
          if (nb < 0) continue;

          // ALLOCATION-FREE: compute allowed into reusable scratch
          unionCompatForCellInto(
            this.allowedScratch,
            this.domain,
            cell,
            this.words,
            this.compat[d]
          );

          const changed = domainAndInPlace(
            this.domain,
            nb,
            this.words,
            this.allowedScratch
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

            this.enqueue(nb);
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

      const chosen = pickTileFromDomainWeighted(
        this.domain,
        cell,
        this.words,
        this.tiles,
        this.rng
      );

      restrictToTile(this.domain, cell, this.words, chosen);
      this.collapsed++;

      events.push({ type: "collapse", cell, tile: chosen });

      // start propagation from this collapsed cell
      this.enqueue(cell);
    }

    return events;
  }
}
