// wfc_view.ts
import {
  Application,
  Assets,
  Container,
  RenderTexture,
  Sprite,
  Texture,
} from "pixi.js";

import type { TileDef, WorkerOutMsg } from "./types";

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function chunkKey(cx: number, cy: number) {
  return `${cx},${cy}`;
}

export type WfcViewOpts = {
  mountEl: HTMLElement;
  tileSize: number;
  tiles: TileDef[];
  gridW: number;
  gridH: number;
  seed: number;
};

export type WfcView = { destroy: () => void };

type UiMode = "paused" | "running" | "stepping" | "done" | "error";

type UiState = {
  mode: UiMode;
  runTarget: number;
  stepRemaining: number;
  stepTarget: number;
  errorMessage?: string;
};

function makeInitialUiState(): UiState {
  return {
    mode: "paused",
    runTarget: 0,
    stepRemaining: 0,
    stepTarget: 0,
  };
}

function activityLine(state: UiState) {
  switch (state.mode) {
    case "running":
      return `RUNNING: trying to collapse ${state.runTarget || "..."}`;
    case "stepping":
      return `STEPPING: trying to collapse ${state.stepRemaining} more`;
    case "done":
      return "DONE";
    case "error":
      return "ERROR";
    default:
      return "PAUSED";
  }
}

export async function createWfcView(opts: WfcViewOpts): Promise<WfcView> {
  const { mountEl, tileSize: TILE, tiles, gridW, gridH, seed } = opts;

  // Track collapsed tile index per cell for click-debugging
  const collapsedGrid = new Int32Array(gridW * gridH);
  collapsedGrid.fill(-1);

  // --- container layout ---
  mountEl.innerHTML = "";
  mountEl.style.position = "relative";
  mountEl.style.height = "calc(100vh - 72px)";
  mountEl.style.minHeight = "520px";
  mountEl.style.border = "1px solid #232323";
  mountEl.style.borderRadius = "16px";
  mountEl.style.background = "#0b0b0b";
  mountEl.style.overflow = "hidden";

  // --- pixi init ---
  const app = new Application();
  await app.init({
    resizeTo: mountEl,
    antialias: false,
    backgroundAlpha: 1,
    background: "#0b0b0b",
  });

  app.canvas.style.width = "100%";
  app.canvas.style.height = "100%";
  app.canvas.style.display = "block";
  mountEl.appendChild(app.canvas);

  // Load textures
  await Assets.load(tiles.map((t) => `/${t.file}`));
  const texByFile = new Map<string, Texture>();
  for (const t of tiles) texByFile.set(t.file, Texture.from(`/${t.file}`));

  const world = new Container();
  app.stage.addChild(world);

  // Chunked rendering
  const CHUNK_TILES = 64;
  const chunkPx = CHUNK_TILES * TILE;
  const chunkSprites = new Map<string, { sprite: Sprite; rt: RenderTexture }>();

  function getOrCreateChunk(cx: number, cy: number) {
    const key = chunkKey(cx, cy);
    const existing = chunkSprites.get(key);
    if (existing) return existing;

    const rt = RenderTexture.create({ width: chunkPx, height: chunkPx });
    const spr = new Sprite(rt);
    spr.x = cx * chunkPx;
    spr.y = cy * chunkPx;
    world.addChild(spr);

    const entry = { sprite: spr, rt };
    chunkSprites.set(key, entry);
    return entry;
  }

  function clearAllChunks() {
    for (const { rt } of chunkSprites.values()) {
      const empty = new Container();
      app.renderer.render({ container: empty, target: rt, clear: true });
    }
  }

  // Entropy overlay (cheap activity map)
  const entropyCanvas = document.createElement("canvas");
  entropyCanvas.width = gridW;
  entropyCanvas.height = gridH;
  const entropyCtx = entropyCanvas.getContext("2d", {
    willReadFrequently: true,
  })!;
  const entropyImage = entropyCtx.createImageData(gridW, gridH);

  const entropyTex = Texture.from(entropyCanvas);
  const entropySpr = new Sprite(entropyTex);
  entropySpr.scale.set(TILE, TILE);
  entropySpr.alpha = 0.35;
  world.addChild(entropySpr);

  let showEntropy = true;
  let entropyCursor = 0;

  function resetEntropy() {
    entropyCursor = 0;
    entropyCtx.clearRect(0, 0, entropyCanvas.width, entropyCanvas.height);
    entropyTex.update();
  }

  function updateEntropyOverlay(maxCells: number) {
    if (!showEntropy) return;

    const data = entropyImage.data;
    const total = gridW * gridH;

    let updated = 0;
    while (updated < maxCells) {
      const c = entropyCursor % total;
      entropyCursor++;

      const x = c % gridW;
      const y = (c / gridW) | 0;

      // simple static look; you can later color by entropy if you start sending it
      const intensity = 180;
      const i = (y * gridW + x) * 4;
      data[i + 0] = intensity;
      data[i + 1] = intensity;
      data[i + 2] = intensity;
      data[i + 3] = 255;

      updated++;
    }

    entropyCtx.putImageData(entropyImage, 0, 0);
    entropyTex.update();
  }

  // Draw collapsed tile into chunk RT
  function drawCollapsedTile(cell: number, tileIdx: number) {
    const gx = cell % gridW;
    const gy = (cell / gridW) | 0;

    const cx = Math.floor(gx / CHUNK_TILES);
    const cy = Math.floor(gy / CHUNK_TILES);
    const chunk = getOrCreateChunk(cx, cy);

    const localX = (gx - cx * CHUNK_TILES) * TILE;
    const localY = (gy - cy * CHUNK_TILES) * TILE;

    const v = tiles[tileIdx];
    if (!v) return;

    const tex = texByFile.get(v.file);
    if (!tex) return;

    const s = new Sprite(tex);
    s.x = localX;
    s.y = localY;

    const composed = new Container();
    composed.addChild(s);

    app.renderer.render({
      container: composed,
      target: chunk.rt,
      clear: false,
    });
  }

  // Camera controls
  let camX = 0;
  let camY = 0;
  let zoom = 1;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  app.canvas.addEventListener("mousedown", (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  });

  const onMouseUp = () => (dragging = false);
  const onMouseMove = (e: MouseEvent) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    camX += dx;
    camY += dy;
  };

  window.addEventListener("mouseup", onMouseUp);
  window.addEventListener("mousemove", onMouseMove);

  app.canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      zoom = clamp(zoom * factor, 0.25, 3);
    },
    { passive: false }
  );

  function updateWorldTransform() {
    world.scale.set(zoom);
    world.x = camX;
    world.y = camY;
  }

  // --- Debug click probe (logs tile ids, edges, and neighbor compatibility) ---
  function neighborCell(cell: number, dir: "n" | "e" | "s" | "w") {
    const gx = cell % gridW;
    const gy = (cell / gridW) | 0;

    if (dir === "n") return gy > 0 ? cell - gridW : -1;
    if (dir === "s") return gy + 1 < gridH ? cell + gridW : -1;
    if (dir === "e") return gx + 1 < gridW ? cell + 1 : -1;
    return gx > 0 ? cell - 1 : -1;
  }

  function edgeKeys(t: TileDef, dir: "n" | "e" | "s" | "w") {
    const rules =
      dir === "n"
        ? t.edges.n
        : dir === "e"
        ? t.edges.e
        : dir === "s"
        ? t.edges.s
        : t.edges.w;
    return new Set(rules.map((r) => r.key));
  }

  function intersects(a: Set<string>, b: Set<string>) {
    if (a.size > b.size) [a, b] = [b, a];
    for (const k of a) if (b.has(k)) return true;
    return false;
  }

  function compatPair(
    aIdx: number,
    bIdx: number,
    dirFromAToB: "n" | "e" | "s" | "w"
  ) {
    const a = tiles[aIdx];
    const b = tiles[bIdx];
    if (!a || !b) return { ok: false as const, reason: "missing tile def" };

    const opp =
      dirFromAToB === "n"
        ? "s"
        : dirFromAToB === "s"
        ? "n"
        : dirFromAToB === "e"
        ? "w"
        : "e";

    const aSet = edgeKeys(a, dirFromAToB);
    const bSet = edgeKeys(b, opp);

    const ok = intersects(aSet, bSet);

    return {
      ok,
      aDir: dirFromAToB,
      bDir: opp,
      aKeys: [...aSet],
      bKeys: [...bSet],
    };
  }

  function screenToGrid(e: MouseEvent) {
    const rect = app.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    const wx = (sx - camX) / zoom;
    const wy = (sy - camY) / zoom;

    const gx = Math.floor(wx / TILE);
    const gy = Math.floor(wy / TILE);

    if (gx < 0 || gy < 0 || gx >= gridW || gy >= gridH) return null;

    const cell = gy * gridW + gx;
    return { gx, gy, cell };
  }

  app.canvas.addEventListener("click", (e) => {
    const p = screenToGrid(e);
    if (!p) return;

    const { gx, gy, cell } = p;
    const tIdx = collapsedGrid[cell];

    console.groupCollapsed(`WFC Inspect gx=${gx} gy=${gy} cell=${cell}`);

    if (tIdx < 0) {
      console.log("Cell is not collapsed (yet).");
      console.groupEnd();
      return;
    }

    const t = tiles[tIdx];
    console.log("Tile:", { idx: tIdx, id: t?.id, file: t?.file });

    if (t) {
      console.log("Edges:", {
        n: t.edges.n.map((r) => r.key),
        e: t.edges.e.map((r) => r.key),
        s: t.edges.s.map((r) => r.key),
        w: t.edges.w.map((r) => r.key),
      });
    }

    const dirs: Array<["n" | "e" | "s" | "w", string]> = [
      ["n", "North"],
      ["e", "East"],
      ["s", "South"],
      ["w", "West"],
    ];

    for (const [d, label] of dirs) {
      const nbCell = neighborCell(cell, d);
      if (nbCell < 0) continue;

      const nbIdx = collapsedGrid[nbCell];
      if (nbIdx < 0) {
        console.log(`${label} neighbor: not collapsed`);
        continue;
      }

      const nbTile = tiles[nbIdx];
      const check = compatPair(tIdx, nbIdx, d);

      console.log(`${label} neighbor:`, {
        nbCell,
        nbIdx,
        nbId: nbTile?.id,
        nbFile: nbTile?.file,
        compatible: check.ok,
        ...(check.ok
          ? {}
          : {
              aDir: check.aDir,
              bDir: check.bDir,
              aKeys: check.aKeys,
              bKeys: check.bKeys,
            }),
      });
    }

    console.groupEnd();
  });

  // UI overlay
  const ui = document.createElement("div");
  ui.style.position = "absolute";
  ui.style.top = "12px";
  ui.style.left = "12px";
  ui.style.width = "340px";
  ui.style.padding = "10px";
  ui.style.background = "rgba(0,0,0,0.65)";
  ui.style.color = "#e6e6e6";
  ui.style.fontFamily = "system-ui, Arial";
  ui.style.fontSize = "13px";
  ui.style.borderRadius = "12px";
  ui.style.userSelect = "none";
  ui.style.zIndex = "10";
  ui.style.border = "1px solid rgba(255,255,255,0.12)";
  ui.style.display = "flex";
  ui.style.flexDirection = "column";
  ui.style.gap = "10px";
  mountEl.appendChild(ui);

  const statusTop = document.createElement("div");
  statusTop.style.opacity = "0.9";
  statusTop.textContent = "Paused";
  ui.appendChild(statusTop);

  const progressWrap = document.createElement("div");
  progressWrap.style.width = "100%";
  progressWrap.style.height = "10px";
  progressWrap.style.border = "1px solid rgba(255,255,255,0.25)";
  progressWrap.style.borderRadius = "6px";
  progressWrap.style.overflow = "hidden";
  ui.appendChild(progressWrap);

  const progressBar = document.createElement("div");
  progressBar.style.height = "100%";
  progressBar.style.width = "0%";
  progressBar.style.background = "rgba(255,255,255,0.72)";
  progressWrap.appendChild(progressBar);

  const row1 = document.createElement("div");
  row1.style.display = "flex";
  row1.style.gap = "8px";
  row1.style.alignItems = "center";
  ui.appendChild(row1);

  const btnRun = document.createElement("button");
  btnRun.textContent = "Run";
  row1.appendChild(btnRun);

  const btnPause = document.createElement("button");
  btnPause.textContent = "Pause";
  row1.appendChild(btnPause);

  const btnStep = document.createElement("button");
  btnStep.textContent = "Step";
  row1.appendChild(btnStep);

  const btnRestart = document.createElement("button");
  btnRestart.textContent = "Restart";
  row1.appendChild(btnRestart);

  for (const b of [btnRun, btnPause, btnStep, btnRestart]) {
    b.style.background = "rgba(255,255,255,0.06)";
    b.style.border = "1px solid rgba(255,255,255,0.14)";
    b.style.color = "#e6e6e6";
    b.style.borderRadius = "8px";
    b.style.padding = "6px 10px";
    b.style.cursor = "pointer";
  }

  const row2 = document.createElement("div");
  row2.style.display = "flex";
  row2.style.gap = "10px";
  row2.style.alignItems = "center";
  ui.appendChild(row2);

  const speedLabel = document.createElement("span");
  speedLabel.textContent = "UI draw speed:";
  speedLabel.style.opacity = "0.9";
  row2.appendChild(speedLabel);

  const speed = document.createElement("input");
  speed.type = "range";
  speed.min = "50";
  speed.max = "5000";
  speed.value = "1200";
  row2.appendChild(speed);

  const speedValue = document.createElement("span");
  speedValue.textContent = speed.value;
  speedValue.style.minWidth = "52px";
  speedValue.style.textAlign = "right";
  speedValue.style.opacity = "0.9";
  row2.appendChild(speedValue);

  speed.addEventListener("input", () => (speedValue.textContent = speed.value));

  const row3 = document.createElement("div");
  row3.style.display = "flex";
  row3.style.gap = "10px";
  row3.style.alignItems = "center";
  ui.appendChild(row3);

  const chkEntropy = document.createElement("input");
  chkEntropy.type = "checkbox";
  chkEntropy.checked = true;
  row3.appendChild(chkEntropy);

  const lblEntropy = document.createElement("label");
  lblEntropy.textContent = "Entropy overlay";
  lblEntropy.style.opacity = "0.9";
  row3.appendChild(lblEntropy);

  chkEntropy.addEventListener("change", () => {
    showEntropy = chkEntropy.checked;
    entropySpr.visible = showEntropy;
  });

  const statusBar = document.createElement("div");
  statusBar.style.marginTop = "2px";
  statusBar.style.paddingTop = "8px";
  statusBar.style.borderTop = "1px solid rgba(255,255,255,0.10)";
  statusBar.style.fontFamily =
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
  statusBar.style.fontSize = "12px";
  statusBar.style.lineHeight = "1.3";
  statusBar.style.whiteSpace = "pre-wrap";
  statusBar.style.opacity = "0.95";
  ui.appendChild(statusBar);

  // --- Worker wiring ---
  const uiState = makeInitialUiState();
  let pendingDraws: Array<{ cell: number; tile: number }> = [];

  // Stats from worker
  let statCollapsed = 0;
  let statCells = gridW * gridH;
  let statVariants = tiles.length;
  let statQueue = 0;
  let statRemaining = 0;

  let liveDrain = {
    drainPropagationsSoFar: 0,
    drainMsSoFar: 0,
    optionsRemovedSoFar: 0,
    cellsTouched: 0,
    maxEntropyDropInSingleCell: 0,
  };

  function applyMode(mode: UiMode) {
    uiState.mode = mode;

    btnRun.disabled = mode === "running" || mode === "done" || mode === "error";
    btnPause.disabled = mode !== "running";
    btnStep.disabled =
      mode === "running" || mode === "done" || mode === "error";

    btnRun.style.opacity = btnRun.disabled ? "0.5" : "1";
    btnPause.style.opacity = btnPause.disabled ? "0.5" : "1";
    btnStep.style.opacity = btnStep.disabled ? "0.5" : "1";
    btnRestart.style.opacity = btnRestart.disabled ? "0.5" : "1";

    if (mode === "paused") statusTop.textContent = "Paused";
    else if (mode === "running") statusTop.textContent = "Running";
    else if (mode === "stepping") statusTop.textContent = "Stepping";
    else if (mode === "done") statusTop.textContent = "Done";
    else if (mode === "error") statusTop.textContent = "Error";
  }

  let worker: Worker | null = null;

  function wireWorker(w: Worker) {
    w.onmessage = (e: MessageEvent<WorkerOutMsg>) => {
      const msg = e.data;

      if (msg.type === "state") {
        if (msg.state.mode === "running") {
          uiState.runTarget = msg.state.targetCollapses ?? 0;
          applyMode("running");
        } else if (msg.state.mode === "stepping") {
          uiState.stepTarget = msg.state.targetCollapses;
          uiState.stepRemaining = msg.state.targetCollapses;
          applyMode("stepping");
        } else if (msg.state.mode === "paused") {
          applyMode("paused");
        } else if (msg.state.mode === "done") {
          applyMode("done");
        } else if (msg.state.mode === "error") {
          uiState.errorMessage = msg.state.message;
          applyMode("error");
        }
        return;
      }

      if (msg.type === "batch") {
        pendingDraws.push(...msg.collapsed);

        statCollapsed = msg.stats.collapsed;
        statCells = msg.stats.cells;
        statVariants = msg.stats.variants;
        statQueue = msg.stats.queueSize;
        statRemaining = msg.stats.remaining;

        if (uiState.mode === "stepping") {
          uiState.stepRemaining = Math.max(
            0,
            uiState.stepRemaining - msg.collapsed.length
          );
        }
        return;
      }

      if (msg.type === "progress") {
        liveDrain = msg.diag;
        statQueue = msg.stats?.queueSize ?? statQueue;
        statRemaining = msg.stats?.remaining ?? statRemaining;
        statCollapsed = msg.stats?.collapsed ?? statCollapsed;
        statVariants = msg.stats?.variants ?? statVariants;
        statCells = msg.stats?.cells ?? statCells;
        return;
      }

      if (msg.type === "restart") {
        console.warn("WFC restart");
        pendingDraws = [];
        clearAllChunks();
        resetEntropy();
        collapsedGrid.fill(-1);
        return;
      }

      if (msg.type === "done") {
        applyMode("done");
        return;
      }

      if (msg.type === "error") {
        uiState.errorMessage = msg.message;
        console.error(msg.message);
        applyMode("error");
        return;
      }
    };
  }

  function createWorkerAndInit(initSeed: number) {
    const w = new Worker(new URL("./wfc_worker.ts", import.meta.url), {
      type: "module",
    });
    wireWorker(w);

    const maxRestarts = 30;
    w.postMessage({
      type: "init",
      tiles,
      gridW,
      gridH,
      opts: { seed: initSeed, maxRestarts },
    });

    return w;
  }

  worker = createWorkerAndInit(seed);
  applyMode("paused");

  // --- Button actions ---
  btnRun.onclick = () => {
    if (!worker) return;
    if (uiState.mode === "done" || uiState.mode === "error") return;
    worker.postMessage({ type: "run" });
  };

  btnPause.onclick = () => {
    if (!worker) return;
    worker.postMessage({ type: "pause" });
    // worker will emit state=paused after it yields between chunks
  };

  btnStep.onclick = () => {
    if (!worker) return;
    if (uiState.mode === "done" || uiState.mode === "error") return;

    // Stop run loop (pause is honored between chunks)
    worker.postMessage({ type: "pause" });

    const n = 1;
    uiState.stepTarget = n;
    uiState.stepRemaining = n;
    applyMode("stepping");

    worker.postMessage({ type: "step", collapses: n });
  };

  btnRestart.onclick = () => {
    // Hard cancel: kill worker and recreate.
    // This gives instant responsiveness without slowing propagation.
    if (worker) {
      worker.terminate();
      worker = null;
    }

    pendingDraws = [];
    clearAllChunks();
    resetEntropy();
    collapsedGrid.fill(-1);

    // reset stats so UI doesn't look "stuck"
    statCollapsed = 0;
    statQueue = 0;
    statRemaining = 0;
    liveDrain = {
      drainPropagationsSoFar: 0,
      drainMsSoFar: 0,
      optionsRemovedSoFar: 0,
      cellsTouched: 0,
      maxEntropyDropInSingleCell: 0,
    };

    const nextSeed =
      (((seed + ((Math.random() * 1e9) | 0)) >>> 0) as number) >>> 0;

    worker = createWorkerAndInit(nextSeed);
    applyMode("paused");
  };

  // --- render loop ---
  let lastTickDrawn = 0;
  let emaDrawPerSec = 0;
  let lastPerfT = performance.now();

  app.ticker.add(() => {
    updateWorldTransform();

    const DRAW_BUDGET = Math.max(1, Number(speed.value) | 0);

    lastTickDrawn = 0;
    while (lastTickDrawn < DRAW_BUDGET && pendingDraws.length > 0) {
      const it = pendingDraws.shift()!;
      collapsedGrid[it.cell] = it.tile; // record for click-debugging
      drawCollapsedTile(it.cell, it.tile);
      lastTickDrawn++;
    }

    const now = performance.now();
    const dt = (now - lastPerfT) / 1000;
    if (dt > 0) {
      const drawPerSec = lastTickDrawn / dt;
      const a = 0.15;
      emaDrawPerSec = emaDrawPerSec * (1 - a) + drawPerSec * a;
    }
    lastPerfT = now;

    if (showEntropy)
      updateEntropyOverlay(uiState.mode === "paused" ? 2000 : 12000);

    const pct = statCells > 0 ? (statCollapsed / statCells) * 100 : 0;
    progressBar.style.width = `${pct.toFixed(2)}%`;

    statusBar.textContent =
      `Collapsed: ${statCollapsed} / ${statCells} (${pct.toFixed(2)}%)\n` +
      `Variants: ${statVariants}\n` +
      `Worker queue: ${statQueue.toLocaleString()} | Pending draws: ${pendingDraws.length.toLocaleString()}\n` +
      `Remaining possibilities: ${statRemaining.toLocaleString()}\n` +
      `Drain (live): ${liveDrain.drainPropagationsSoFar.toLocaleString()} props in ${liveDrain.drainMsSoFar.toFixed(
        1
      )}ms \n` +
      // Add time in hh:mm:ss format for liveDrain.drainMsSoFar
      (() => {
        const ms = Math.floor(liveDrain.drainMsSoFar);
        const sec = Math.floor(ms / 1000);
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = sec % 60;
        return `Drain (live time): ${h.toString().padStart(2, "0")}:${m
          .toString()
          .padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
      })() +
      "\n" +
      // NEW line:
      `Drain (useful): -${(
        liveDrain.optionsRemovedSoFar ?? 0
      ).toLocaleString()} options | touched=${(
        liveDrain.cellsTouched ?? 0
      ).toLocaleString()} | maxDrop=${(
        liveDrain.maxEntropyDropInSingleCell ?? 0
      ).toLocaleString()}\n` +
      `Draw: +${lastTickDrawn} / tick | ${emaDrawPerSec.toFixed(
        0
      )} / sec | Zoom: ${zoom.toFixed(2)}\n` +
      `${activityLine(uiState)}`;
  });

  return {
    destroy: () => {
      if (worker) worker.terminate();
      app.destroy(true);
      ui.remove();
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("mousemove", onMouseMove);
      mountEl.innerHTML = "";
    },
  };
}
