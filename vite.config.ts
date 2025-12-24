import { defineConfig, type Plugin } from "vite";
import fs from "node:fs";
import path from "node:path";

type EdgeRule = { key: string; weight: number }; // now always present after normalize

type TileV2 = {
  id: string;
  file: string; // "tiles/<name>.png"
  weight: number; // always present after normalize
  edges: { n: EdgeRule[]; e: EdgeRule[]; s: EdgeRule[]; w: EdgeRule[] };
};

type TilesetV2 = {
  meta: { version: 2; tileSize?: number };
  tiles: TileV2[];
};

// -----------------------------
// small utils (type-safe)
// -----------------------------
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function getProp(obj: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
}

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function asArray(v: unknown): unknown[] | null {
  return Array.isArray(v) ? v : null;
}

function normTileWeight(w: unknown): number {
  const n = Number(w);
  return Number.isFinite(n) && n > 0 ? Number(n.toFixed(4)) : 1;
}

function normRuleWeight(w: unknown): number {
  const n = Number(w);
  return Number.isFinite(n) && n > 0 ? Number(n.toFixed(4)) : 1;
}

function writeJsonAtomic(p: string, data: unknown) {
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, p);
}

// -----------------------------
// JSON -> TilesetV2 normalizers
// -----------------------------
function normEdgeRules(v: unknown): EdgeRule[] {
  const arr = asArray(v);
  if (!arr) return [];

  const out: EdgeRule[] = [];
  for (const item of arr) {
    if (!isRecord(item)) continue;
    const key = (asString(getProp(item, "key")) ?? "").trim();
    if (!key) continue;

    out.push({
      key,
      weight: normRuleWeight(getProp(item, "weight")),
    });
  }
  return out;
}

function normEdges(v: unknown): TileV2["edges"] {
  // Accept malformed shapes; coerce to {n,e,s,w}
  if (!isRecord(v)) {
    return { n: [], e: [], s: [], w: [] };
  }
  return {
    n: normEdgeRules(getProp(v, "n")),
    e: normEdgeRules(getProp(v, "e")),
    s: normEdgeRules(getProp(v, "s")),
    w: normEdgeRules(getProp(v, "w")),
  };
}

function isTilesetV2Shape(
  v: unknown
): v is { meta: { version: 2 }; tiles: unknown[] } {
  if (!isRecord(v)) return false;
  const meta = getProp(v, "meta");
  const tiles = getProp(v, "tiles");
  if (!isRecord(meta)) return false;
  return getProp(meta, "version") === 2 && Array.isArray(tiles);
}

function normalizeTilesetV2(raw: unknown): TilesetV2 {
  const fresh: TilesetV2 = { meta: { version: 2, tileSize: 16 }, tiles: [] };
  if (!isTilesetV2Shape(raw)) return fresh;

  const root = raw as Record<string, unknown>;
  const metaRaw = getProp(root, "meta");
  const tilesRaw = getProp(root, "tiles");

  const tileSize =
    isRecord(metaRaw) && typeof getProp(metaRaw, "tileSize") === "number"
      ? (getProp(metaRaw, "tileSize") as number)
      : fresh.meta.tileSize;

  const tilesArr = asArray(tilesRaw) ?? [];

  const tiles: TileV2[] = [];
  for (const t of tilesArr) {
    if (!isRecord(t)) continue;

    const file = (asString(getProp(t, "file")) ?? "")
      .replace(/\\/g, "/")
      .trim();
    if (!file) continue;

    const base = path.posix.basename(file).replace(/\.[^.]+$/, "");
    const id = (asString(getProp(t, "id")) ?? "").trim() || base;

    tiles.push({
      id,
      file,
      weight: normTileWeight(getProp(t, "weight")),
      edges: normEdges(getProp(t, "edges")),
    });
  }

  return {
    meta: { version: 2, tileSize },
    tiles,
  };
}

// -----------------------------
// POST body -> TileV2 normalizer
// -----------------------------
function normalizeIncomingTile(
  raw: unknown
): { ok: true; tile: TileV2 } | { ok: false; error: string } {
  if (!isRecord(raw)) return { ok: false, error: "Body must be a JSON object" };

  const fileRaw = asString(getProp(raw, "file"));
  if (!fileRaw) return { ok: false, error: `Missing "file"` };

  const file = fileRaw.replace(/\\/g, "/").trim();
  if (!file) return { ok: false, error: `Missing "file"` };

  const base = path.posix.basename(file).replace(/\.[^.]+$/, "");
  const id = (asString(getProp(raw, "id")) ?? "").trim() || base;

  const edges = normEdges(getProp(raw, "edges"));

  return {
    ok: true,
    tile: {
      id,
      file,
      weight: normTileWeight(getProp(raw, "weight")),
      edges,
    },
  };
}

// -----------------------------
// plugin
// -----------------------------
function tilesetPlugin(): Plugin {
  return {
    name: "tileset-dev-api",
    configureServer(server) {
      const root = server.config.root ?? process.cwd();
      const tilesDir = path.join(root, "tiles");
      const tilesetPath = path.join(root, "tileset.json");

      function listPngs(): string[] {
        if (!fs.existsSync(tilesDir)) return [];
        return fs
          .readdirSync(tilesDir)
          .filter((f) => f.toLowerCase().endsWith(".png"))
          .sort((a, b) => a.localeCompare(b))
          .map((f) => `tiles/${f}`);
      }

      function archiveCurrentTilesetFile() {
        const stamp = new Date()
          .toISOString()
          .replace(/[-:]/g, "")
          .replace(/\..+/, "");
        const archived = path.join(root, `tileset.backup.${stamp}.json`);
        try {
          fs.renameSync(tilesetPath, archived);
        } catch {
          // ignore
        }
      }

      function loadTileset(): TilesetV2 {
        const fresh: TilesetV2 = {
          meta: { version: 2, tileSize: 16 },
          tiles: [],
        };
        if (!fs.existsSync(tilesetPath)) return fresh;

        try {
          const rawText = fs.readFileSync(tilesetPath, "utf8");
          const rawJson: unknown = JSON.parse(rawText);

          if (!isTilesetV2Shape(rawJson)) {
            archiveCurrentTilesetFile();
            return fresh;
          }

          // normalize existing v2 in memory
          return normalizeTilesetV2(rawJson);
        } catch {
          archiveCurrentTilesetFile();
          return fresh;
        }
      }

      // GET /api/tileset -> { images, tileset }
      server.middlewares.use("/api/tileset", (req, res, next) => {
        if (req.method !== "GET") return next();

        const images = listPngs();
        const tileset = loadTileset();

        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ images, tileset }, null, 2));
      });

      // POST /api/tileset/tile
      server.middlewares.use("/api/tileset/tile", (req, res, next) => {
        if (req.method !== "POST") return next();

        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          try {
            const raw: unknown = JSON.parse(body || "{}");
            const parsed = normalizeIncomingTile(raw);

            if (!parsed.ok) {
              res.statusCode = 400;
              return res.end(parsed.error);
            }

            const nextTile = parsed.tile;
            const tileset = loadTileset();

            // Upsert by file (stable key)
            const idx = tileset.tiles.findIndex(
              (t) => t.file === nextTile.file
            );
            if (idx >= 0) tileset.tiles[idx] = nextTile;
            else tileset.tiles.push(nextTile);

            // Keep file order same as folder listing
            const order = new Map(listPngs().map((f, i) => [f, i]));
            tileset.tiles.sort(
              (a, b) => (order.get(a.file) ?? 1e9) - (order.get(b.file) ?? 1e9)
            );

            writeJsonAtomic(tilesetPath, tileset);

            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: true, tileset }, null, 2));
          } catch (e: unknown) {
            res.statusCode = 400;
            res.end(
              `Bad JSON or save error: ${
                e instanceof Error ? e.message : String(e)
              }`
            );
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [tilesetPlugin()],
  server: { port: 5173, strictPort: true },
});
