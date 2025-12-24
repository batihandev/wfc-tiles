/// <reference lib="webworker" />

// wfc_worker.ts
import type {
  TileDef,
  WfcStepperOptions,
  WorkerInMsg,
  WorkerOutMsg,
  WorkerDiag,
  WorkerProgress,
} from "./types";
import type { WfcEvent } from "./wfc_stepper";
import { WfcStepper } from "./wfc_stepper";

let baseTiles: TileDef[] = [];
let gridW = 0;
let gridH = 0;
let opts: WfcStepperOptions | null = null;

let stepper: WfcStepper | null = null;
let running = false;

// generation token: any init increments and cancels in-flight loop
let runGen = 0;

let lastProgressPost = 0;
const PROGRESS_POST_EVERY_MS = 100;

// These are *chunk* boundaries. Pause is honored between chunks.
const TARGET_PER_CHUNK = 1;

type Diag = WorkerDiag;

let lastDiag: Diag = {
  lastDrainPropagations: 0,
  lastDrainMs: 0,
  maxDrainPropagationsEver: 0,
};

function post(msg: WorkerOutMsg) {
  self.postMessage(msg);
}

function rebuild(seedOverride?: number) {
  if (!opts) return;
  const seed = (seedOverride ?? opts.seed) >>> 0;
  stepper = new WfcStepper(baseTiles, gridW, gridH, { ...opts, seed });

  lastDiag = {
    lastDrainPropagations: 0,
    lastDrainMs: 0,
    maxDrainPropagationsEver: 0,
  };
}

function computeRemainingPossibilities(s: WfcStepper): number {
  let sum = 0;
  for (let c = 0; c < s.cells; c++) sum += s.entropy(c);
  return sum;
}

function makeProgressCb() {
  return (p: WorkerProgress) => {
    const now = performance.now();
    if (now - lastProgressPost >= PROGRESS_POST_EVERY_MS) {
      lastProgressPost = now;
      post({
        type: "progress",
        diag: p,
        // add these:
        stats: stepper
          ? {
              queueSize: stepper.queueSize,
              remaining: computeRemainingPossibilities(stepper),
              collapsed: stepper.collapsed,
              cells: stepper.cells,
              variants: stepper.tiles.length,
            }
          : undefined,
      });
    }
  };
}

function updateLastDiagFromEvents(events: WfcEvent[]) {
  for (const ev of events) {
    if (ev.type === "diag") {
      lastDiag = {
        lastDrainPropagations: ev.lastDrainPropagations,
        lastDrainMs: ev.lastDrainMs,
        maxDrainPropagationsEver: ev.maxDrainPropagationsEver,
      };
    }
  }
}

async function runLoop(gen: number) {
  if (!stepper) return;

  post({
    type: "state",
    state: { mode: "running", targetCollapses: TARGET_PER_CHUNK },
  });

  while (running && stepper && gen === runGen) {
    const events = stepper.step(TARGET_PER_CHUNK, makeProgressCb());
    updateLastDiagFromEvents(events);

    const batch: Array<{ cell: number; tile: number }> = [];

    for (const ev of events) {
      if (ev.type === "collapse") batch.push({ cell: ev.cell, tile: ev.tile });
      else if (ev.type === "restart") post({ type: "restart" });
      else if (ev.type === "done") {
        running = false;
        post({ type: "done" });
        post({ type: "state", state: { mode: "done" } });
        break;
      } else if (ev.type === "error") {
        running = false;
        post({ type: "error", message: ev.message });
        post({ type: "state", state: { mode: "error", message: ev.message } });
        break;
      }
    }

    if (!stepper || gen !== runGen) break;

    post({
      type: "batch",
      collapsed: batch,
      stats: {
        collapsed: stepper.collapsed,
        cells: stepper.cells,
        variants: stepper.tiles.length,
        queueSize: stepper.queueSize,
        remaining: computeRemainingPossibilities(stepper),
      },
    });

    // yield so pause can be processed quickly (between chunks)
    await new Promise<void>((r) => setTimeout(r, 0));
  }

  if (gen === runGen) post({ type: "state", state: { mode: "paused" } });
}

self.onmessage = (e: MessageEvent<WorkerInMsg>) => {
  const msg = e.data;

  if (msg.type === "init") {
    runGen++; // cancel in-flight loop
    running = false;

    baseTiles = msg.tiles;
    gridW = msg.gridW;
    gridH = msg.gridH;
    opts = msg.opts;

    rebuild(msg.opts.seed);
    post({ type: "state", state: { mode: "paused" } });
    return;
  }

  if (msg.type === "run") {
    if (!stepper) rebuild();
    if (!stepper) return;

    if (!running) {
      running = true;
      const myGen = ++runGen;
      void runLoop(myGen);
    }
    return;
  }

  if (msg.type === "pause") {
    running = false;
    // state will be posted once the loop yields back (between chunks)
    return;
  }

  if (msg.type === "step") {
    if (!stepper) rebuild();
    if (!stepper) return;

    running = false;
    runGen++; // cancel in-flight loop promptly

    const n = Math.max(1, msg.collapses ?? 1);
    post({ type: "state", state: { mode: "stepping", targetCollapses: n } });

    const events = stepper.step(n, makeProgressCb());
    updateLastDiagFromEvents(events);

    const batch: Array<{ cell: number; tile: number }> = [];
    let doneOrError = false;
    let sawRestart = false;
    for (const ev of events) {
      if (ev.type === "collapse") {
        if (!sawRestart) batch.push({ cell: ev.cell, tile: ev.tile });
      } else if (ev.type === "restart") {
        sawRestart = true;
        post({ type: "restart" });
        // IMPORTANT: drop any collapses from the failed attempt
        batch.length = 0;
      } else if (ev.type === "done") {
        running = false;
        post({ type: "done" });
        post({ type: "state", state: { mode: "done" } });
        break;
      } else if (ev.type === "error") {
        running = false;
        post({ type: "error", message: ev.message });
        post({ type: "state", state: { mode: "error", message: ev.message } });
        break;
      }
    }

    post({
      type: "batch",
      collapsed: batch,
      stats: {
        collapsed: stepper.collapsed,
        cells: stepper.cells,
        variants: stepper.tiles.length,
        queueSize: stepper.queueSize,
        remaining: computeRemainingPossibilities(stepper),
      },
    });

    if (!doneOrError) post({ type: "state", state: { mode: "paused" } });
    return;
  }
};
