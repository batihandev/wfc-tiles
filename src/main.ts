// src/main.ts
import {
  Application,
  Assets,
  Container,
  RenderTexture,
  Sprite,
  Texture,
} from "pixi.js";
import { WfcStepper, type TileDef } from "./wfc_stepper";

type Tileset = {
  meta: { tileSize: number; tileCount: number };
  tiles: TileDef[];
};
function edgeColor(ch: string) {
  // red
  return ch === "A" ? 0xff4444 : 0x4444ff;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function chunkKey(cx: number, cy: number) {
  return `${cx},${cy}`;
}

async function main() {
  const res = await fetch("/tileset.json");
  if (!res.ok) throw new Error(`Failed to load tileset.json: ${res.status}`);
  const tileset = (await res.json()) as Tileset;

  const TILE = tileset.meta.tileSize ?? 16;

  // You can start smaller (e.g. 256x256) while debugging
  const WORLD_PX = 8000;
  const gridW = Math.floor(WORLD_PX / TILE); // 500
  const gridH = Math.floor(WORLD_PX / TILE); // 500

  const app = new Application();
  await app.init({ resizeTo: window, antialias: false, backgroundAlpha: 1 });
  document.body.appendChild(app.canvas);

  // Load textures for base tiles (rotations reuse same file)
  await Assets.load(tileset.tiles.map((t) => `/${t.file}`));
  const texByFile = new Map<string, Texture>();
  for (const t of tileset.tiles)
    texByFile.set(t.file, Texture.from(`/${t.file}`));

  // Chunked rendering setup
  const CHUNK_TILES = 64;
  const chunkPx = CHUNK_TILES * TILE;

  const world = new Container();
  app.stage.addChild(world);

  // Each chunk: { sprite, rt, dirty }
  const chunkSprites = new Map<
    string,
    { sprite: Sprite; rt: RenderTexture; dirty: boolean }
  >();

  function getOrCreateChunk(cx: number, cy: number) {
    const key = chunkKey(cx, cy);
    const existing = chunkSprites.get(key);
    if (existing) return existing;

    const rt = RenderTexture.create({ width: chunkPx, height: chunkPx });
    const spr = new Sprite(rt);
    spr.x = cx * chunkPx;
    spr.y = cy * chunkPx;

    world.addChild(spr);

    const entry = { sprite: spr, rt, dirty: false };
    chunkSprites.set(key, entry);
    return entry;
  }

  // Entropy overlay via CanvasTexture (updated periodically)
  const entropyCanvas = document.createElement("canvas");
  entropyCanvas.width = gridW;
  entropyCanvas.height = gridH;
  const entropyCtx = entropyCanvas.getContext("2d", {
    willReadFrequently: true,
  })!;
  const entropyImage = entropyCtx.createImageData(gridW, gridH);

  const entropyTex = Texture.from(entropyCanvas);
  const entropySpr = new Sprite(entropyTex);
  entropySpr.scale.set(TILE, TILE); // 1 canvas pixel per tile
  entropySpr.alpha = 0.35;
  world.addChild(entropySpr);

  let showEntropy = true;

  function updateEntropyOverlay(stepper: WfcStepper, maxCells: number) {
    // Update entropy progressively to avoid stalls: only touch N cells per tick.
    // We sweep using a rolling cursor.
    // Encoding: collapsed=dark, high entropy=bright
    if (!showEntropy) return;

    const data = entropyImage.data;
    const total = stepper.cells;

    // rolling cursor stored on function object
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const self = updateEntropyOverlay as any;
    if (self.cursor === undefined) self.cursor = 0;

    let updated = 0;
    while (updated < maxCells) {
      const c = self.cursor % total;
      self.cursor++;

      const e = stepper.entropy(c); // 1..N
      const x = c % gridW;
      const y = (c / gridW) | 0;

      // Map entropy to intensity: 1 -> 0, >=8 -> 255 (tune)
      const intensity = clamp(((e - 1) / 7) * 255, 0, 255) | 0;
      const i = (y * gridW + x) * 4;

      // white overlay intensity
      data[i + 0] = intensity;
      data[i + 1] = intensity;
      data[i + 2] = intensity;
      data[i + 3] = 255;

      updated++;
    }

    entropyCtx.putImageData(entropyImage, 0, 0);
    entropyTex.update();
  }

  // Draw a single collapsed tile onto its chunk RenderTexture
  function drawCollapsedTile(
    stepper: WfcStepper,
    cell: number,
    tileIdx: number
  ) {
    const gx = cell % gridW;
    const gy = (cell / gridW) | 0;

    const cx = Math.floor(gx / CHUNK_TILES);
    const cy = Math.floor(gy / CHUNK_TILES);
    const chunk = getOrCreateChunk(cx, cy);

    const localX = (gx - cx * CHUNK_TILES) * TILE;
    const localY = (gy - cy * CHUNK_TILES) * TILE;

    const v = stepper.tiles[tileIdx];
    const tex = texByFile.get(v.file)!;

    const s = new Sprite(tex);
    s.x = localX;
    s.y = localY;

    // rotation ...
    if (v.rot !== 0) {
      s.pivot.set(TILE / 2, TILE / 2);
      s.position.set(localX + TILE / 2, localY + TILE / 2);
      s.rotation = (Math.PI / 2) * v.rot;
    }

    // Build a small container so we can render tile + overlay in one pass
    const composed = new Container();
    composed.addChild(s);

    if (showEdges) {
      // Draw 3 segments per side. Each segment is 1/3 of the edge.
      // Thickness: 2px (tweak). Segment length: TILE/3.
      const seg = TILE / 3;
      const thick = 0.5;

      // N edge at top
      for (let i = 0; i < 3; i++) {
        const t = new Sprite(Texture.WHITE);
        t.width = seg;
        t.height = thick;
        t.tint = edgeColor(v.edges.n[i]);
        t.x = localX + i * seg;
        t.y = localY;
        composed.addChild(t);
      }

      // S edge at bottom
      for (let i = 0; i < 3; i++) {
        const b = new Sprite(Texture.WHITE);
        b.width = seg;
        b.height = thick;
        b.tint = edgeColor(v.edges.s[i]);
        b.x = localX + i * seg;
        b.y = localY + TILE - thick;
        composed.addChild(b);
      }

      // W edge at left (vertical segments)
      for (let i = 0; i < 3; i++) {
        const l = new Sprite(Texture.WHITE);
        l.width = thick;
        l.height = seg;
        l.tint = edgeColor(v.edges.w[i]);
        l.x = localX;
        l.y = localY + i * seg;
        composed.addChild(l);
      }

      // E edge at right
      for (let i = 0; i < 3; i++) {
        const r = new Sprite(Texture.WHITE);
        r.width = thick;
        r.height = seg;
        r.tint = edgeColor(v.edges.e[i]);
        r.x = localX + TILE - thick;
        r.y = localY + i * seg;
        composed.addChild(r);
      }
    }

    // Render tile + overlay onto chunk RT
    app.renderer.render({
      container: composed,
      target: chunk.rt,
      clear: false,
    });

    chunk.dirty = true;
  }
  function drawAllResolvedTiles(stepper: WfcStepper) {
    for (let cell = 0; cell < stepper.cells; cell++) {
      const tile = stepper.collapsedTile(cell);
      if (tile !== -1) {
        drawCollapsedTile(stepper, cell, tile);
      }
    }
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
  window.addEventListener("mouseup", () => (dragging = false));
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    camX += dx;
    camY += dy;
  });

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

  // Minimal UI controls (DOM overlay)
  const ui = document.createElement("div");
  ui.style.position = "fixed";
  ui.style.top = "10px";
  ui.style.left = "10px";
  ui.style.padding = "10px";
  ui.style.background = "rgba(0,0,0,0.65)";
  ui.style.color = "white";
  ui.style.fontFamily = "system-ui, Arial";
  ui.style.fontSize = "13px";
  ui.style.borderRadius = "8px";
  ui.style.userSelect = "none";
  ui.style.zIndex = "9999";
  document.body.appendChild(ui);

  const status = document.createElement("div");
  status.style.marginBottom = "8px";
  ui.appendChild(status);

  // Progress bar
  const progressWrap = document.createElement("div");
  progressWrap.style.width = "260px";
  progressWrap.style.height = "10px";
  progressWrap.style.border = "1px solid rgba(255,255,255,0.35)";
  progressWrap.style.borderRadius = "6px";
  progressWrap.style.overflow = "hidden";
  progressWrap.style.marginBottom = "8px";
  ui.appendChild(progressWrap);

  const progressBar = document.createElement("div");
  progressBar.style.height = "100%";
  progressBar.style.width = "0%";
  progressBar.style.background = "rgba(255,255,255,0.75)";
  progressWrap.appendChild(progressBar);

  const subStatus = document.createElement("div");
  subStatus.style.opacity = "0.9";
  subStatus.style.marginBottom = "8px";
  ui.appendChild(subStatus);

  const row1 = document.createElement("div");
  row1.style.display = "flex";
  row1.style.gap = "8px";
  row1.style.alignItems = "center";
  row1.style.marginBottom = "8px";
  ui.appendChild(row1);

  const btnPause = document.createElement("button");
  btnPause.textContent = "Pause";
  row1.appendChild(btnPause);

  const btnStep = document.createElement("button");
  btnStep.textContent = "Step";
  row1.appendChild(btnStep);

  const btnRestart = document.createElement("button");
  btnRestart.textContent = "Restart";
  row1.appendChild(btnRestart);

  const row2 = document.createElement("div");
  row2.style.display = "flex";
  row2.style.gap = "10px";
  row2.style.alignItems = "center";
  row2.style.marginBottom = "8px";
  ui.appendChild(row2);

  const speedLabel = document.createElement("span");
  speedLabel.textContent = "Speed:";
  row2.appendChild(speedLabel);

  const speed = document.createElement("input");
  speed.type = "range";
  speed.min = "1";
  speed.max = "500";
  speed.value = "120"; // collapses per frame (budget)
  row2.appendChild(speed);

  const speedValue = document.createElement("span");
  speedValue.textContent = speed.value;
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

  let showEdges = true;

  const chkEdges = document.createElement("input");
  chkEdges.type = "checkbox";
  chkEdges.checked = true;
  row3.appendChild(chkEdges);

  const lblEdges = document.createElement("label");
  lblEdges.textContent = "Edges overlay";
  row3.appendChild(lblEdges);

  chkEdges.addEventListener("change", () => {
    showEdges = chkEdges.checked;
  });

  const lblEntropy = document.createElement("label");
  lblEntropy.textContent = "Entropy overlay";
  row3.appendChild(lblEntropy);

  chkEntropy.addEventListener("change", () => {
    showEntropy = chkEntropy.checked;
    entropySpr.visible = showEntropy;
  });

  // WFC runtime with cooperative scheduling
  let paused = false;
  let singleStep = false;

  let totalPropagations = 0;
  let totalCollapses = 0;

  let lastTickTime = performance.now();
  let lastProp = 0;
  let lastColl = 0;

  const seed = 12345;

  let stepper = new WfcStepper(tileset.tiles, gridW, gridH, {
    seed,
    allowRotate: false,
    maxRestarts: 40,
    macroGrass: { enabled: true }, // you can tune later
  });

  function clearAllChunks() {
    for (const { rt } of chunkSprites.values()) {
      // Clear RT by rendering empty container with clear=true
      const empty = new Container();
      app.renderer.render({ container: empty, target: rt, clear: true });
    }
  }

  function restart() {
    // remove old chunk textures and clear
    clearAllChunks();

    // reset entropy canvas
    entropyCtx.clearRect(0, 0, entropyCanvas.width, entropyCanvas.height);
    entropyTex.update();

    stepper = new WfcStepper(tileset.tiles, gridW, gridH, {
      seed: (seed + ((Math.random() * 1e9) | 0)) >>> 0,
      allowRotate: false,
      maxRestarts: 40,
    });

    paused = false;
    btnPause.textContent = "Pause";
  }

  btnPause.onclick = () => {
    paused = !paused;
    btnPause.textContent = paused ? "Resume" : "Pause";
  };

  btnStep.onclick = () => {
    paused = true;
    btnPause.textContent = "Resume";
    singleStep = true;
  };

  btnRestart.onclick = () => restart();

  // Frame loop:
  // - run a controlled amount of WFC work each tick (no freezing)
  // - draw collapsed tiles immediately
  // - update entropy overlay incrementally
  app.ticker.add(() => {
    updateWorldTransform();

    const collapsesBudget = paused
      ? singleStep
        ? 1
        : 0
      : parseInt(speed.value, 10);
    const propagationsBudget = paused ? 200 : 1500;

    if (collapsesBudget > 0) {
      const events = stepper.step(collapsesBudget, propagationsBudget);

      for (const ev of events) {
        if (ev.type === "collapse") {
          totalCollapses++;
          drawCollapsedTile(stepper, ev.cell, ev.tile);
        } else if (ev.type === "propagate") {
          totalPropagations++;
        } else if (ev.type === "restart") {
          clearAllChunks();
        } else if (ev.type === "done") {
          paused = true;
          btnPause.textContent = "Done";
          console.log("WFC complete");
          drawAllResolvedTiles(stepper);
          // Optional: finalize rendering (see Fix 2)
        } else if (ev.type === "error") {
          paused = true;
          btnPause.textContent = "Error";
          console.error(ev.message);
        }
      }

      if (singleStep) singleStep = false;
    }

    // Update entropy overlay gradually so it never freezes either
    updateEntropyOverlay(stepper, paused ? 2000 : 12000);

    // Status
    const collapsed = stepper.collapsed;
    const cells = stepper.cells;
    const pct = (collapsed / cells) * 100;
    progressBar.style.width = `${pct.toFixed(2)}%`;

    // Compute per-second activity so you can tell it's alive even when collapsed doesn't move
    const now = performance.now();
    const dt = (now - lastTickTime) / 1000;
    if (dt >= 0.5) {
      const dProp = totalPropagations - lastProp;
      const dColl = totalCollapses - lastColl;

      const propPerSec = Math.round(dProp / dt);
      const collPerSec = Math.round(dColl / dt);

      lastTickTime = now;
      lastProp = totalPropagations;
      lastColl = totalCollapses;

      // queue size: we don't currently expose it; see section C below to add it.
      subStatus.textContent =
        `Rate: ${collPerSec}/s collapses, ${propPerSec}/s propagations` +
        ` | Queue: ${stepper.queueSize.toLocaleString()}`;
    }

    status.textContent =
      `Collapsed: ${collapsed} / ${cells} | Tiles: ${stepper.tiles.length} ` +
      `| Zoom: ${zoom.toFixed(2)} | ${paused ? "PAUSED / DONE" : "RUNNING"}`;
  });
}

main().catch((err) => {
  console.error(err);
  const pre = document.createElement("pre");
  pre.style.whiteSpace = "pre-wrap";
  pre.textContent = String(err?.stack ?? err);
  document.body.appendChild(pre);
});
