export type EdgeRule = { key: string; weight: number };

export type TilesetV2 = {
  meta: { version: 2; tileSize?: number };
  tiles: TileV2[];
};

export type ApiState = {
  images: string[];
  tileset: TilesetV2;
};

export type Dir = "n" | "e" | "s" | "w";
export const DIRS: Dir[] = ["n", "e", "s", "w"];

export type TilesetApiSaveResp = { ok: true; tileset: TilesetV2 };

export type TileDef = {
  id: string;
  file: string;
  weight: number; // always normalized to > 0, default 1
  edges: { n: EdgeRule[]; e: EdgeRule[]; s: EdgeRule[]; w: EdgeRule[] };
};
export type TileV2 = TileDef;

export type Variant = TileDef & { rot: 0 | 1 | 2 | 3 };

export type WfcStepperOptions = {
  seed: number;
  maxRestarts?: number;
};

export type WorkerDiag = {
  lastDrainPropagations: number;
  lastDrainMs: number;
  maxDrainPropagationsEver: number;
};

export type WorkerStats = {
  collapsed: number;
  cells: number;
  variants: number;
  queueSize: number;
  remaining: number;
};

export type WorkerProgress = {
  drainPropagationsSoFar: number;
  drainMsSoFar: number;
  optionsRemovedSoFar: number; // total options eliminated in this drain
  cellsTouched: number; // number of cells whose domain actually changed
  maxEntropyDropInSingleCell: number; // max (beforeCount - afterCount) seen in any single changed
};

export type WorkerState =
  | { mode: "paused" }
  | { mode: "running"; targetCollapses: number }
  | { mode: "stepping"; targetCollapses: number }
  | { mode: "done" }
  | { mode: "error"; message: string };

export type WorkerInMsg =
  | {
      type: "init";
      tiles: TileDef[];
      gridW: number;
      gridH: number;
      opts: WfcStepperOptions;
    }
  | { type: "run" }
  | { type: "pause" }
  | { type: "step"; collapses?: number }
  | { type: "restart"; seed?: number };

export type WorkerOutMsg =
  | {
      type: "batch";
      collapsed: Array<{ cell: number; tile: number }>;
      stats: WorkerStats;
    }
  | { type: "progress"; diag: WorkerProgress; stats?: WorkerStats }
  | { type: "state"; state: WorkerState }
  | { type: "done" }
  | { type: "restart" }
  | { type: "error"; message: string };
