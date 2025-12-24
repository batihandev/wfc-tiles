import type { Dir, EdgeRule, TileV2 } from "./types";
import { DIRS } from "./types";

export type KeywordIndex = {
  // keyword -> count across all tiles/edges
  counts: Map<string, number>;
  // keyword -> per-dir count
  byDirCounts: Record<Dir, Map<string, number>>;
  // keyword -> list of tiles that include it on each dir
  tilesByKeywordByDir: Record<Dir, Map<string, TileV2[]>>;
  // flattened suggestion arrays (sorted)
  allSuggestions: string[];
  suggestionsByDir: Record<Dir, string[]>;
};

function normKey(k: string): string {
  return (k ?? "").trim().toLowerCase();
}

function pushMapArr<K, V>(m: Map<K, V[]>, key: K, value: V) {
  const arr = m.get(key);
  if (arr) arr.push(value);
  else m.set(key, [value]);
}

export function buildKeywordIndex(tiles: TileV2[]): KeywordIndex {
  const counts = new Map<string, number>();
  const byDirCounts = {
    n: new Map<string, number>(),
    e: new Map<string, number>(),
    s: new Map<string, number>(),
    w: new Map<string, number>(),
  } as Record<Dir, Map<string, number>>;

  const tilesByKeywordByDir = {
    n: new Map<string, TileV2[]>(),
    e: new Map<string, TileV2[]>(),
    s: new Map<string, TileV2[]>(),
    w: new Map<string, TileV2[]>(),
  } as Record<Dir, Map<string, TileV2[]>>;

  for (const t of tiles) {
    for (const dir of DIRS) {
      const rules = t.edges?.[dir] ?? [];
      const seenLocal = new Set<string>(); // avoid double-counting same keyword within same edge list
      for (const r of rules) {
        const k = normKey(r.key);
        if (!k) continue;
        if (seenLocal.has(k)) continue;
        seenLocal.add(k);

        counts.set(k, (counts.get(k) ?? 0) + 1);
        byDirCounts[dir].set(k, (byDirCounts[dir].get(k) ?? 0) + 1);
        pushMapArr(tilesByKeywordByDir[dir], k, t);
      }
    }
  }

  const allSuggestions = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k]) => k);

  const suggestionsByDir = {
    n: Array.from(byDirCounts.n.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([k]) => k),
    e: Array.from(byDirCounts.e.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([k]) => k),
    s: Array.from(byDirCounts.s.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([k]) => k),
    w: Array.from(byDirCounts.w.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([k]) => k),
  } as Record<Dir, string[]>;

  return {
    counts,
    byDirCounts,
    tilesByKeywordByDir,
    allSuggestions,
    suggestionsByDir,
  };
}

// Used by autocomplete: filter suggestions by prefix and keep it light
export function suggest(
  prefix: string,
  suggestions: string[],
  limit = 8
): string[] {
  const p = (prefix ?? "").trim().toLowerCase();
  if (!p) return suggestions.slice(0, limit);
  const out: string[] = [];
  for (const s of suggestions) {
    if (s.startsWith(p)) out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}
