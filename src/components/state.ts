import { KeywordIndex } from "./keyword_index";
import type { ApiState, Dir, TileV2, TilesetV2 } from "./types";

export type CompatQuery =
  | { open: false }
  | {
      open: true;
      dir: Dir;
      keyword: string; // normalized
    };

export type TilesetEditorState = {
  api: ApiState;
  byFile: Map<string, TileV2>;
  selectedFile: string | null;
  compareFile: string | null;
  draft: TileV2 | null;
  keywordIndex?: KeywordIndex;
  compat: CompatQuery;
  activeKeyword?: { dir: Dir; keyword: string };
};

export function emptyTile(file: string): TileV2 {
  const base = file
    .split("/")
    .pop()!
    .replace(/\.[^.]+$/, "");
  return {
    id: base,
    file,
    weight: 1,
    edges: { n: [], e: [], s: [], w: [] },
  };
}

export function hasAnyEdges(t: TileV2) {
  return (
    t.edges.n.length + t.edges.e.length + t.edges.s.length + t.edges.w.length >
    0
  );
}

export function rebuildIndex(tileset: TilesetV2) {
  const byFile = new Map<string, TileV2>();
  for (const t of tileset.tiles) byFile.set(t.file, t);
  return byFile;
}
