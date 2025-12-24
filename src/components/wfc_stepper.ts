// wfc_stepper.ts
import type {
  TileDef,
  EdgeRule,
  WfcStepperOptions,
  WorkerProgress,
} from "./types";

type RNG = () => number;

function mulberry32(seed: number): RNG {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (t >>> 7), 61 | x);
    return ((x ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type ProgressCb = (p: WorkerProgress) => void;

type Dir = 0 | 1 | 2 | 3; // N,E,S,W
const DIRS: Dir[] = [0, 1, 2, 3];
const OPP: Dir[] = [2, 3, 0, 1];

function neighborIndex(x: number, y: number, w: number, h: number, d: Dir) {
  if (d === 0) return y > 0 ? (y - 1) * w + x : -1;
  if (d === 1) return x + 1 < w ? y * w + (x + 1) : -1;
  if (d === 2) return y + 1 < h ? (y + 1) * w + x : -1;
  return x > 0 ? y * w + (x - 1) : -1;
}

// --- Bitset helpers ---
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
    if (v !== 0) return w * 32 + popLowestBitIndex(v);
  }
  return -1;
}

function domainAndInPlaceDelta(
  domain: Uint32Array,
  cell: number,
  words: number,
  mask: Uint32Array
): {
  changed: boolean;
  removed: number; // number of bits removed
  beforeCount: number;
  afterCount: number;
} {
  const base = cell * words;

  let changed = false;
  let beforeCount = 0;
  let afterCount = 0;

  for (let w = 0; w < words; w++) {
    const prev = domain[base + w];
    const next = prev & mask[w];

    if (next !== prev) {
      changed = true;

      domain[base + w] = next;
    }

    beforeCount += countBits32(prev);
    afterCount += countBits32(next);
  }
  const removed = beforeCount - afterCount;
  return { changed, removed, beforeCount, afterCount };
}

// --- Rule maps / scoring ---
type RuleMap = Map<string, number>;

function buildRuleMap(rules: EdgeRule[]): RuleMap {
  const m: RuleMap = new Map();
  for (const r of rules) {
    const prev = m.get(r.key);
    if (prev === undefined || r.weight > prev) m.set(r.key, r.weight);
  }
  return m;
}

function canMatchMaps(a: RuleMap, b: RuleMap): boolean {
  if (a.size === 0 || b.size === 0) return false;
  const small = a.size <= b.size ? a : b;
  const big = a.size <= b.size ? b : a;
  for (const k of small.keys()) if (big.has(k)) return true;
  return false;
}

function matchScoreMapArray(aRules: EdgeRule[], bMap: RuleMap): number {
  if (aRules.length === 0 || bMap.size === 0) return 0;
  let s = 0;
  for (const r of aRules) {
    const wb = bMap.get(r.key);
    if (wb !== undefined) s += r.weight * wb;
  }
  return s;
}

function buildCompat(tiles: TileDef[], edgeMaps: RuleMap[][]) {
  const n = tiles.length;
  const words = wordCount(n);

  const compat: Uint32Array[][] = Array.from({ length: 4 }, () =>
    Array.from({ length: n }, () => new Uint32Array(words))
  );

  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      for (const d of DIRS) {
        if (canMatchMaps(edgeMaps[a][d], edgeMaps[b][OPP[d]])) {
          compat[d][a][b >>> 5] |= 1 << (b & 31);
        }
      }
    }
  }

  return { compat, words };
}

function findMinEntropyCell(
  domain: Uint32Array,
  cells: number,
  words: number,
  rng: RNG
) {
  let bestCount = Infinity;
  let bestCell = -1;

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
  | { type: "done" }
  | { type: "restart"; attempt: number }
  | { type: "error"; message: string }
  | {
      type: "diag";
      lastDrainPropagations: number;
      lastDrainMs: number;
      maxDrainPropagationsEver: number;
    };

export class WfcStepper {
  readonly gridW: number;
  readonly gridH: number;
  readonly cells: number;

  readonly tiles: TileDef[];
  readonly words: number;

  private readonly compat: Uint32Array[][];
  private readonly edgeMaps: RuleMap[][];
  private rng: RNG;

  private attempt = 0;
  private readonly maxRestarts: number;

  private domain: Uint32Array;
  private queue: number[] = [];
  private inQueue: Uint8Array;

  // PERFORMANCE: avoid redundant propagations
  private domVer: Uint32Array; // increments when a cell's domain changes
  private propVer: Uint32Array; // last domVer we propagated from

  // PERF: build all 4 allowed-masks from a cell in one pass over its domain bits
  private allowed4: Uint32Array; // length = 4 * words
  private allowedN: Uint32Array;
  private allowedE: Uint32Array;
  private allowedS: Uint32Array;
  private allowedW: Uint32Array;

  // DIAG: per-drain unique touched tracking
  private touchedMark: Uint8Array; // reused; cleared per drain

  collapsed = 0;

  // diagnostics
  private lastDrainPropagations = 0;
  private lastDrainMs = 0;
  private maxDrainPropagationsEver = 0;

  constructor(
    baseTiles: TileDef[],
    gridW: number,
    gridH: number,
    opts: WfcStepperOptions
  ) {
    this.gridW = gridW;
    this.gridH = gridH;
    this.cells = gridW * gridH;

    this.tiles = baseTiles;

    this.edgeMaps = this.tiles.map((t) => [
      buildRuleMap(t.edges.n),
      buildRuleMap(t.edges.e),
      buildRuleMap(t.edges.s),
      buildRuleMap(t.edges.w),
    ]);

    const { compat, words } = buildCompat(this.tiles, this.edgeMaps);
    this.compat = compat;
    this.words = words;

    this.maxRestarts = opts.maxRestarts ?? 30;
    this.rng = mulberry32(opts.seed >>> 0);

    this.domain = new Uint32Array(this.cells * this.words);
    this.inQueue = new Uint8Array(this.cells);

    this.domVer = new Uint32Array(this.cells);
    this.propVer = new Uint32Array(this.cells);

    this.allowed4 = new Uint32Array(4 * this.words);
    this.allowedN = this.allowed4.subarray(0 * this.words, 1 * this.words);
    this.allowedE = this.allowed4.subarray(1 * this.words, 2 * this.words);
    this.allowedS = this.allowed4.subarray(2 * this.words, 3 * this.words);
    this.allowedW = this.allowed4.subarray(3 * this.words, 4 * this.words);

    this.touchedMark = new Uint8Array(this.cells);

    this.resetDomain();
  }

  private enqueue(cell: number) {
    if (this.inQueue[cell]) return;
    this.inQueue[cell] = 1;
    this.queue.push(cell);
  }

  private resetDomain() {
    for (let c = 0; c < this.cells; c++) setAll(this.domain, c, this.words);
    maskUnusedHighBits(this.domain, this.cells, this.words, this.tiles.length);

    this.queue.length = 0;
    this.inQueue.fill(0);

    this.domVer.fill(0);
    this.propVer.fill(0);

    this.collapsed = 0;
    // IMPORTANT: do NOT reset attempt here; attempt counts restarts.
  }

  entropy(cell: number) {
    return countDomain(this.domain, cell, this.words);
  }

  get queueSize() {
    return this.queue.length;
  }

  private bumpVer(cell: number) {
    this.domVer[cell] = (this.domVer[cell] + 1) >>> 0;
  }

  private pickTileWithNeighborBias(cell: number): number {
    const base = cell * this.words;

    const x = cell % this.gridW;
    const y = (cell / this.gridW) | 0;

    const nb: Array<{ d: Dir; bMap: RuleMap }> = [];
    for (const d of DIRS) {
      const ni = neighborIndex(x, y, this.gridW, this.gridH, d);
      if (ni < 0) continue;
      const t =
        this.entropy(ni) === 1
          ? getSingleIndex(this.domain, ni, this.words)
          : -1;
      if (t !== -1) nb.push({ d, bMap: this.edgeMaps[t][OPP[d]] });
    }

    let total = 0;

    for (let w = 0; w < this.words; w++) {
      let bits = this.domain[base + w];
      while (bits !== 0) {
        const bit = popLowestBitIndex(bits);
        bits &= bits - 1;

        const idx = w * 32 + bit;
        const v = this.tiles[idx];

        let wt = v?.weight ?? 1;
        if (!(Number.isFinite(wt) && wt > 0)) continue;

        for (const nbi of nb) {
          const aRules =
            nbi.d === 0
              ? v.edges.n
              : nbi.d === 1
              ? v.edges.e
              : nbi.d === 2
              ? v.edges.s
              : v.edges.w;
          wt *= 1 + matchScoreMapArray(aRules, nbi.bMap);
        }

        total += wt;
      }
    }

    if (!(total > 0)) {
      const options: number[] = [];
      for (let w = 0; w < this.words; w++) {
        let bits = this.domain[base + w];
        while (bits !== 0) {
          const bit = popLowestBitIndex(bits);
          bits &= bits - 1;
          options.push(w * 32 + bit);
        }
      }
      return options[(this.rng() * options.length) | 0];
    }

    let r = this.rng() * total;

    for (let w = 0; w < this.words; w++) {
      let bits = this.domain[base + w];
      while (bits !== 0) {
        const bit = popLowestBitIndex(bits);
        bits &= bits - 1;

        const idx = w * 32 + bit;
        const v = this.tiles[idx];

        let wt = v?.weight ?? 1;
        if (!(Number.isFinite(wt) && wt > 0)) continue;

        for (const nbi of nb) {
          const aRules =
            nbi.d === 0
              ? v.edges.n
              : nbi.d === 1
              ? v.edges.e
              : nbi.d === 2
              ? v.edges.s
              : v.edges.w;
          wt *= 1 + matchScoreMapArray(aRules, nbi.bMap);
        }

        r -= wt;
        if (r <= 0) return idx;
      }
    }

    const fallback = getSingleIndex(this.domain, cell, this.words);
    return fallback >= 0 ? fallback : 0;
  }

  /**
   * PERF: Build allowed masks for N/E/S/W in one scan over the cell's domain bits.
   * - allowedN = OR_t compat[N][t]
   * - allowedE = OR_t compat[E][t]
   * - allowedS = OR_t compat[S][t]
   * - allowedW = OR_t compat[W][t]
   *
   * Returns how many domain bits (tiles) were iterated (diag only).
   */
  private buildAllowed4FromCell(cell: number): number {
    this.allowedN.fill(0);
    this.allowedE.fill(0);
    this.allowedS.fill(0);
    this.allowedW.fill(0);

    const base = cell * this.words;
    let tileIterations = 0;

    for (let w = 0; w < this.words; w++) {
      let bits = this.domain[base + w];
      while (bits !== 0) {
        const bit = popLowestBitIndex(bits);
        bits &= bits - 1;

        const tile = w * 32 + bit;
        tileIterations++;

        const cN = this.compat[0][tile];
        const cE = this.compat[1][tile];
        const cS = this.compat[2][tile];
        const cW = this.compat[3][tile];

        for (let k = 0; k < this.words; k++) {
          this.allowedN[k] |= cN[k];
          this.allowedE[k] |= cE[k];
          this.allowedS[k] |= cS[k];
          this.allowedW[k] |= cW[k];
        }
      }
    }

    return tileIterations;
  }

  step(maxCollapses: number, onProgress?: ProgressCb): WfcEvent[] {
    const events: WfcEvent[] = [];

    this.lastDrainPropagations = 0;
    this.lastDrainMs = 0;

    const drain = (): boolean => {
      const MAX_DRAIN_MS = 1e9;
      const t0 = performance.now();

      this.lastDrainPropagations = 0;

      // diag counters
      let optionsRemovedSoFar = 0;

      // IMPORTANT: "cellsTouched" should be UNIQUE cells changed in this drain
      let cellsTouchedUnique = 0;
      this.touchedMark.fill(0);

      // diag: how many change events (can be >> cells)
      let changeEvents = 0;

      let maxEntropyDropInSingleCell = 0;

      // diag: union/build cost indicators
      let unionRebuilds = 0; // times we rebuilt allowed masks for a popped cell
      let unionTileIterations = 0; // tiles iterated while rebuilding allowed masks

      let lastProgressT = t0;

      const reportProgress = (now: number) => {
        // Your WorkerProgress should include these fields:
        // - optionsRemovedSoFar
        // - cellsTouched (UNIQUE)
        // - maxEntropyDropInSingleCell
        // - changeEvents (optional but recommended)
        // - unionRebuilds (optional)
        // - unionTileIterations (optional)
        onProgress?.({
          drainPropagationsSoFar: this.lastDrainPropagations,
          drainMsSoFar: now - t0,

          optionsRemovedSoFar,
          cellsTouched: cellsTouchedUnique,
          maxEntropyDropInSingleCell,

          // extra diag (add to WorkerProgress type if you want to display them)
          changeEvents,
          unionRebuilds,
          unionTileIterations,
        } as unknown as WorkerProgress);
      };

      while (this.queue.length > 0) {
        if (performance.now() - t0 > MAX_DRAIN_MS) break;

        const now0 = performance.now();
        if (now0 - lastProgressT >= 100) {
          lastProgressT = now0;
          reportProgress(now0);
        }

        const cell = this.queue.pop()!;
        this.inQueue[cell] = 0;

        // PERF: skip if nothing changed since last time we propagated from this cell
        if (this.propVer[cell] === this.domVer[cell]) {
          continue;
        }
        this.propVer[cell] = this.domVer[cell];

        // PERF: build all direction masks once for this cell
        unionRebuilds++;
        unionTileIterations += this.buildAllowed4FromCell(cell);

        const x = cell % this.gridW;
        const y = (cell / this.gridW) | 0;

        for (const d of DIRS) {
          const nb = neighborIndex(x, y, this.gridW, this.gridH, d);
          if (nb < 0) continue;

          const mask =
            d === 0
              ? this.allowedN
              : d === 1
              ? this.allowedE
              : d === 2
              ? this.allowedS
              : this.allowedW;

          const delta = domainAndInPlaceDelta(
            this.domain,
            nb,
            this.words,
            mask
          );
          if (!delta.changed) continue;

          changeEvents++;

          if (this.touchedMark[nb] === 0) {
            this.touchedMark[nb] = 1;
            cellsTouchedUnique++;
          }

          optionsRemovedSoFar += delta.removed;
          const drop = delta.beforeCount - delta.afterCount;
          if (drop > maxEntropyDropInSingleCell)
            maxEntropyDropInSingleCell = drop;

          // domain changed -> bump version so it will be propagated later
          this.bumpVer(nb);

          this.lastDrainPropagations++;

          const now1 = performance.now();
          if (now1 - lastProgressT >= 100) {
            lastProgressT = now1;
            reportProgress(now1);
          }
          if (delta.changed) {
            if (delta.removed < 0) {
              console.warn("NEG removed", { nb, delta });
            }
            if (delta.afterCount > delta.beforeCount) {
              console.warn("Domain grew?", { nb, delta });
            }
          }
          if (domainIsEmpty(this.domain, nb, this.words)) {
            this.attempt++;
            if (this.attempt > this.maxRestarts) {
              events.push({
                type: "error",
                message: `WFC failed after ${this.maxRestarts} restarts.`,
              });
              this.lastDrainMs = performance.now() - t0;
              return false;
            }

            this.resetDomain();
            events.push({ type: "restart", attempt: this.attempt });
            this.lastDrainMs = performance.now() - t0;
            return false;
          }

          this.enqueue(nb);
        }
      }

      this.lastDrainMs = performance.now() - t0;
      return true;
    };

    // drain any queued work first
    if (!drain()) {
      events.push({
        type: "diag",
        lastDrainPropagations: this.lastDrainPropagations,
        lastDrainMs: this.lastDrainMs,

        maxDrainPropagationsEver: this.maxDrainPropagationsEver,
      });
      return events;
    }

    this.maxDrainPropagationsEver = Math.max(
      this.maxDrainPropagationsEver,
      this.lastDrainPropagations
    );

    for (let i = 0; i < maxCollapses; i++) {
      const cell = findMinEntropyCell(
        this.domain,
        this.cells,
        this.words,
        this.rng
      );

      if (cell === -1) {
        events.push({ type: "done" });
        events.push({
          type: "diag",
          lastDrainPropagations: this.lastDrainPropagations,
          lastDrainMs: this.lastDrainMs,

          maxDrainPropagationsEver: this.maxDrainPropagationsEver,
        });
        return events;
      }

      const chosen = this.pickTileWithNeighborBias(cell);

      // collapse
      restrictToTile(this.domain, cell, this.words, chosen);
      this.bumpVer(cell);

      this.collapsed++;
      events.push({ type: "collapse", cell, tile: chosen });

      this.enqueue(cell);

      this.lastDrainPropagations = 0;
      this.lastDrainMs = 0;

      if (!drain()) {
        events.push({
          type: "diag",
          lastDrainPropagations: this.lastDrainPropagations,
          lastDrainMs: this.lastDrainMs,

          maxDrainPropagationsEver: this.maxDrainPropagationsEver,
        });
        return events;
      }

      this.maxDrainPropagationsEver = Math.max(
        this.maxDrainPropagationsEver,
        this.lastDrainPropagations
      );
    }

    events.push({
      type: "diag",
      lastDrainPropagations: this.lastDrainPropagations,
      lastDrainMs: this.lastDrainMs,

      maxDrainPropagationsEver: this.maxDrainPropagationsEver,
    });

    return events;
  }
}
