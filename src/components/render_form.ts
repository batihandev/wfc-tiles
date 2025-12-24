import { styleButton, styleInput } from "./dom";
import type { TileV2 } from "./types";
import { DIRS } from "./types";
import type { TilesetEditorState } from "./state";
import { emptyTile } from "./state";
import { renderEdgeEditor } from "./render_edge_editor";
import { createSuggestionsModal } from "./suggestions_modal";

const suggestionsModal = createSuggestionsModal();
export function trimDraftKeys(draft: TileV2) {
  for (const dir of DIRS) {
    draft.edges[dir] = draft.edges[dir]
      .map((r) => ({ ...r, key: (r.key ?? "").trim() }))
      .filter((r) => r.key.length > 0);
  }
}
export function normalizeTileDefaults(tile: TileV2) {
  // tile-level weight
  if (tile.weight == null || tile.weight <= 0) {
    tile.weight = 1;
  }

  // edge rule weights
  for (const dir of ["n", "e", "s", "w"] as const) {
    for (const r of tile.edges[dir]) {
      if (r.weight == null || r.weight <= 0) {
        r.weight = 1;
      }
    }
  }
}

export function renderTileForm(opts: {
  container: HTMLElement;
  state: TilesetEditorState;
  onStateChanged: () => void;
  onSave: (draft: TileV2) => Promise<void>;
}) {
  const { container, state, onStateChanged, onSave } = opts;
  container.innerHTML = "";

  const draft = state.draft;
  if (!draft) return;

  // header row (id + weight)
  const formHeader = document.createElement("div");
  formHeader.style.display = "grid";
  formHeader.style.gridTemplateColumns = "1fr 140px";
  formHeader.style.gap = "10px";
  formHeader.style.marginBottom = "10px";

  const idInput = document.createElement("input");
  idInput.value = draft.id;
  idInput.placeholder = "id";
  styleInput(idInput);
  idInput.oninput = () => {
    draft.id = idInput.value;
  };

  const tileW = document.createElement("input");
  tileW.type = "number";
  tileW.step = "0.1";
  tileW.min = "0";
  tileW.placeholder = "tile weight";
  tileW.value = draft.weight === undefined ? "" : String(draft.weight);
  styleInput(tileW);
  tileW.oninput = () => {
    const v = Number(tileW.value);
    draft.weight = Number.isFinite(v) && v > 0 ? v : 1;
  };

  formHeader.appendChild(idInput);
  formHeader.appendChild(tileW);
  container.appendChild(formHeader);

  // helpers
  const helpers = document.createElement("div");
  helpers.style.display = "flex";
  helpers.style.gap = "8px";
  helpers.style.marginBottom = "10px";

  const copyNS = document.createElement("button");
  copyNS.textContent = "Copy N → S";
  styleButton(copyNS, "ghost");
  copyNS.onclick = () => {
    draft.edges.s = draft.edges.n.map((x) => ({ ...x }));
    onStateChanged();
  };

  const copyEW = document.createElement("button");
  copyEW.textContent = "Copy E → W";
  styleButton(copyEW, "ghost");
  copyEW.onclick = () => {
    draft.edges.w = draft.edges.e.map((x) => ({ ...x }));
    onStateChanged();
  };

  helpers.appendChild(copyNS);
  helpers.appendChild(copyEW);
  container.appendChild(helpers);

  // edges
  renderEdgeEditor({
    container,
    label: "n",
    rules: draft.edges.n,
    state,
    onChange: onStateChanged,
    suggestionsModal,
    onOpenCompat: (dir, keyword) => {
      state.compat = { open: true, dir, keyword };
      state.activeKeyword = { dir, keyword };
      onStateChanged();
    },
  });
  renderEdgeEditor({
    container,
    label: "e",
    rules: draft.edges.e,
    state,
    suggestionsModal,
    onChange: onStateChanged,
    onOpenCompat: (dir, keyword) => {
      state.compat = { open: true, dir, keyword };
      state.activeKeyword = { dir, keyword };
      onStateChanged();
    },
  });
  renderEdgeEditor({
    container,
    label: "s",
    rules: draft.edges.s,
    state,
    suggestionsModal,
    onChange: onStateChanged,
    onOpenCompat: (dir, keyword) => {
      state.compat = { open: true, dir, keyword };
      state.activeKeyword = { dir, keyword };
      onStateChanged();
    },
  });
  renderEdgeEditor({
    container,
    label: "w",
    rules: draft.edges.w,
    state,
    suggestionsModal,
    onChange: onStateChanged,
    onOpenCompat: (dir, keyword) => {
      state.compat = { open: true, dir, keyword };
      state.activeKeyword = { dir, keyword };
      onStateChanged();
    },
  });

  // actions
  const actions = document.createElement("div");
  actions.style.display = "flex";
  actions.style.gap = "10px";
  actions.style.position = "sticky";
  actions.style.bottom = "0";
  actions.style.padding = "10px 0";
  actions.style.background =
    "linear-gradient(transparent, rgba(11,11,11,0.85))";

  const save = document.createElement("button");
  save.textContent = "Save Tile";
  styleButton(save, "ok");
  save.onclick = async () => {
    normalizeTileDefaults(draft);
    trimDraftKeys(draft);
    await onSave(draft);
  };

  const next = document.createElement("button");
  next.textContent = "Next →";
  styleButton(next, "primary");
  next.onclick = () => {
    const images = state.api.images;
    if (!state.selectedFile || images.length === 0) return;

    const idx = images.indexOf(state.selectedFile);
    const n = images[(idx + 1) % images.length];
    state.selectedFile = n;
    state.draft = structuredClone(state.byFile.get(n) ?? emptyTile(n));
    onStateChanged();
  };

  actions.appendChild(save);
  actions.appendChild(next);
  container.appendChild(actions);
}
