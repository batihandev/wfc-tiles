import type { EdgeRule, TileDef, TilesetV2, TileV2 } from "./types";

function numOr(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normWeight(v: unknown, fallback = 1): number {
  const n = numOr(v, fallback);
  return n > 0 ? n : fallback;
}

function normKey(v: unknown): string {
  return String(v ?? "")
    .trim()
    .toLowerCase();
}

function normRules(v: unknown): EdgeRule[] {
  if (!Array.isArray(v)) return [];
  const out: EdgeRule[] = [];
  for (const x of v) {
    const key = normKey((x as any)?.key);
    if (!key) continue;
    const weight = normWeight((x as any)?.weight, 1);
    out.push({ key, weight });
  }
  return out;
}

function ensureV2(obj: unknown): TilesetV2 {
  if (
    !obj ||
    typeof obj !== "object" ||
    !(obj as any).meta ||
    (obj as any).meta.version !== 2 ||
    !Array.isArray((obj as any).tiles)
  ) {
    throw new Error("tileset.json is not TilesetV2 (meta.version !== 2)");
  }

  const raw = obj as TilesetV2;

  const tiles: TileV2[] = raw.tiles.map((t) => {
    const tile: TileV2 = {
      id: String(t.id ?? "").trim(),
      file: String(t.file ?? "").replace(/\\/g, "/"),
      weight: normWeight((t as any).weight, 1),
      edges: {
        n: normRules((t as any).edges?.n),
        e: normRules((t as any).edges?.e),
        s: normRules((t as any).edges?.s),
        w: normRules((t as any).edges?.w),
      },
    };

    if (!tile.id) {
      const base =
        tile.file
          .split("/")
          .pop()
          ?.replace(/\.[^.]+$/, "") ?? "tile";
      tile.id = base;
    }
    return tile;
  });

  return {
    meta: { version: 2, tileSize: numOr(raw.meta.tileSize, 16) },
    tiles,
  };
}

export async function loadTilesetAsTileDefs(): Promise<{
  tileSize: number;
  tileDefs: TileDef[];
}> {
  const res = await fetch("/tileset.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load /tileset.json (${res.status})`);

  const json = (await res.json()) as unknown;
  const ts = ensureV2(json);

  const tileDefs: TileDef[] = ts.tiles.map((t) => ({
    id: t.id,
    file: t.file,
    weight: t.weight ?? 1,
    edges: t.edges,
  }));

  return { tileSize: ts.meta.tileSize ?? 16, tileDefs };
}
