// src/main.ts
import {
  Application,
  Assets,
  Container,
  RenderTexture,
  Sprite,
  Texture,
} from "pixi.js";
import { wfcGenerate, type TileDef } from "./wfc";

type Tileset = {
  meta: { tileSize: number; tileCount: number };
  tiles: TileDef[];
};

function chunkKey(cx: number, cy: number) {
  return `${cx},${cy}`;
}

async function main() {
  const res = await fetch("/tileset.json");
  if (!res.ok) throw new Error(`Failed to load tileset.json: ${res.status}`);
  const tileset = (await res.json()) as Tileset;

  const TILE = tileset.meta.tileSize ?? 16;

  const WORLD_PX = 8000;
  const gridW = Math.floor(WORLD_PX / TILE); // 500
  const gridH = Math.floor(WORLD_PX / TILE); // 500

  const app = new Application();
  await app.init({
    resizeTo: window,
    backgroundAlpha: 1,
    antialias: false,
  });

  document.body.appendChild(app.canvas);

  // Load textures for base tiles (rotations reuse the same file)
  await Assets.load(tileset.tiles.map((t) => `/${t.file}`));
  const texByFile = new Map<string, Texture>();
  for (const t of tileset.tiles)
    texByFile.set(t.file, Texture.from(`/${t.file}`));

  // ---- REAL WFC ----
  const { tiles: variants, result } = wfcGenerate(tileset.tiles, gridW, gridH, {
    seed: 12345,
    allowRotate: true, // turn off if you want strict “no rotation”
    maxRestarts: 40,
  });

  // Chunked render
  const CHUNK_TILES = 64;
  const chunkPx = CHUNK_TILES * TILE;

  const world = new Container();
  app.stage.addChild(world);

  const chunks = new Map<string, Sprite>();

  function buildChunkSprite(cx: number, cy: number): Sprite {
    const rt = RenderTexture.create({ width: chunkPx, height: chunkPx });
    const temp = new Container();

    const startX = cx * CHUNK_TILES;
    const startY = cy * CHUNK_TILES;

    for (let ty = 0; ty < CHUNK_TILES; ty++) {
      for (let tx = 0; tx < CHUNK_TILES; tx++) {
        const gx = startX + tx;
        const gy = startY + ty;
        if (gx >= gridW || gy >= gridH) continue;

        const idx = result[gy * gridW + gx];
        const v = variants[idx];

        const tex = texByFile.get(v.file)!;
        const s = new Sprite(tex);
        s.x = tx * TILE;
        s.y = ty * TILE;

        // apply rotation around tile center for 90° increments
        if (v.rot !== 0) {
          s.pivot.set(TILE / 2, TILE / 2);
          s.position.set(s.x + TILE / 2, s.y + TILE / 2);
          s.rotation = (Math.PI / 2) * v.rot;
        }

        temp.addChild(s);
      }
    }

    app.renderer.render({ container: temp, target: rt, clear: true });

    const out = new Sprite(rt);
    out.x = cx * chunkPx;
    out.y = cy * chunkPx;
    return out;
  }

  // Camera (drag to pan, wheel to zoom)
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
      zoom = Math.max(0.25, Math.min(3, zoom * factor));
    },
    { passive: false }
  );

  function updateVisibleChunks() {
    world.scale.set(zoom);
    world.x = camX;
    world.y = camY;

    const viewLeft = -camX / zoom;
    const viewTop = -camY / zoom;
    const viewRight = viewLeft + app.renderer.width / zoom;
    const viewBottom = viewTop + app.renderer.height / zoom;

    const minCx = Math.floor(viewLeft / chunkPx) - 1;
    const minCy = Math.floor(viewTop / chunkPx) - 1;
    const maxCx = Math.floor(viewRight / chunkPx) + 1;
    const maxCy = Math.floor(viewBottom / chunkPx) + 1;

    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        if (cx < 0 || cy < 0) continue;
        const key = chunkKey(cx, cy);
        if (chunks.has(key)) continue;

        const s = buildChunkSprite(cx, cy);
        chunks.set(key, s);
        world.addChild(s);
      }
    }
  }

  app.ticker.add(() => updateVisibleChunks());
}

main().catch((err) => {
  console.error(err);
  const pre = document.createElement("pre");
  pre.style.whiteSpace = "pre-wrap";
  pre.textContent = String(err?.stack ?? err);
  document.body.appendChild(pre);
});
