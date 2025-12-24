import {
  baseName,
  styleButton,
  styleSmallPill,
  styleRowSelectable,
  Tone,
} from "./dom";
import { emptyTile, hasAnyEdges } from "./state";
import type { TilesetEditorState } from "./state";

const SKIP_STORAGE_KEY = "wfc_tileset_skip_v1";

function loadSkipSet(): Set<string> {
  try {
    const raw = localStorage.getItem(SKIP_STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x) => typeof x === "string"));
  } catch {
    return new Set();
  }
}

function saveSkipSet(set: Set<string>) {
  localStorage.setItem(SKIP_STORAGE_KEY, JSON.stringify([...set]));
}

export function renderList(opts: {
  listEl: HTMLElement;
  statusEl: HTMLElement;
  searchEl: HTMLInputElement;
  state: TilesetEditorState;
  onSelect: () => void;
  onCompare: () => void;
}) {
  const { listEl, statusEl, searchEl, state } = opts;
  listEl.innerHTML = "";

  const skipSet = loadSkipSet();

  const q = searchEl.value.trim().toLowerCase();
  const filtered = state.api.images.filter((f) => f.toLowerCase().includes(q));

  // Sort:
  // 0 = OK, 1 = TODO, 2 = SKIP (always last)
  const rank = (f: string) => {
    const skipped = skipSet.has(f);
    if (skipped) return 2;

    const t = state.byFile.get(f);
    const ok = t && hasAnyEdges(t);
    return ok ? 0 : 1;
  };

  filtered.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });

  for (const f of filtered) {
    const existing = state.byFile.get(f);
    const ok = existing && hasAnyEdges(existing);
    const skipped = skipSet.has(f);

    const row = document.createElement("div");
    row.style.display = "grid";
    row.style.gridTemplateColumns = "1fr auto auto auto";
    row.style.gap = "8px";
    row.style.alignItems = "center";
    row.style.padding = "8px";
    row.style.borderRadius = "12px";
    row.style.marginBottom = "6px";
    row.style.cursor = "pointer";

    // Prefer shared styling (keeps consistency)
    // If you don't have styleRowSelectable, replace with your old background/border.
    styleRowSelectable(row, {
      selected: f === state.selectedFile,
      tone: "info",
    });
    row.style.background = f === state.selectedFile ? "#151515" : "#0f0f0f";

    const name = document.createElement("div");
    name.textContent = baseName(f);
    name.style.fontSize = "13px";
    name.style.overflow = "hidden";
    name.style.textOverflow = "ellipsis";
    name.style.whiteSpace = "nowrap";
    name.style.opacity = skipped ? "0.75" : "1";

    const previewBtn = document.createElement("button");
    previewBtn.textContent = state.compareFile === f ? "Previewing" : "Preview";
    styleButton(previewBtn, "ghost");
    previewBtn.style.padding = "6px 10px";
    previewBtn.style.fontSize = "12px";
    previewBtn.onclick = (ev) => {
      ev.stopPropagation();
      state.compareFile = f === state.compareFile ? null : f;
      opts.onCompare();
    };

    const laterBtn = document.createElement("button");
    laterBtn.textContent = skipped ? "Unskip" : "Later";
    styleButton(laterBtn, "ghost");
    laterBtn.style.padding = "6px 10px";
    laterBtn.style.fontSize = "12px";
    laterBtn.style.opacity = skipped ? "0.9" : "0.75";
    laterBtn.onclick = (ev) => {
      ev.stopPropagation();
      if (skipSet.has(f)) skipSet.delete(f);
      else skipSet.add(f);
      saveSkipSet(skipSet);
      // re-render list only (cheap)
      renderList(opts);
    };

    const badge = document.createElement("div");
    if (skipped) {
      badge.textContent = "LATER";
      styleSmallPill(badge, "warn" as Tone);
      badge.style.opacity = "0.95";
    } else {
      badge.textContent = ok ? "OK" : "TODO";
      styleSmallPill(badge, (ok ? "ok" : "todo") as Tone);
      badge.style.opacity = ok ? "0.95" : "0.7";
    }

    row.appendChild(name);
    row.appendChild(previewBtn);
    row.appendChild(laterBtn);
    row.appendChild(badge);

    row.onclick = () => {
      state.selectedFile = f;
      state.draft = structuredClone(state.byFile.get(f) ?? emptyTile(f));
      opts.onSelect();
    };

    listEl.appendChild(row);
  }

  const total = state.api.images.length;
  const done = state.api.images.filter((f) => {
    const t = state.byFile.get(f);
    return t && hasAnyEdges(t);
  }).length;

  const skippedCount = [...loadSkipSet()].filter((f) =>
    state.api.images.includes(f)
  ).length;

  statusEl.textContent =
    `Tiles: ${total} | Completed: ${done} | Remaining: ${total - done}` +
    (skippedCount ? ` | Later: ${skippedCount}` : "");
}
