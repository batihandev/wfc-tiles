export type EdgeRule = { key: string; weight?: number };

export type TileV2 = {
  id: string;
  file: string; // "tiles/<name>.png"
  weight?: number;
  edges: { n: EdgeRule[]; e: EdgeRule[]; s: EdgeRule[]; w: EdgeRule[] };
};

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
