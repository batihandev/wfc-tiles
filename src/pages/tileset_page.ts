import { applyDarkBase, makeToast } from "./dom";
import { createZoomModal } from "./zoom_modal";
import type { ApiState } from "./types";
import { rebuildIndex, emptyTile } from "./state";
import type { TilesetEditorState } from "./state";
import { renderList } from "./render_list";
import { renderEditor } from "./render_editor";
import type { TileV2, TilesetV2 } from "./types";
import { buildKeywordIndex } from "./keyword_index";

async function fetchApiState(): Promise<ApiState> {
  const res = await fetch("/api/tileset");
  if (!res.ok) throw new Error(`GET /api/tileset failed: ${res.status}`);
  return (await res.json()) as ApiState;
}

export async function renderTilesetPage(root: HTMLElement) {
  applyDarkBase();
  root.innerHTML = "";
  root.style.height = "100vh";
  root.style.display = "flex";
  root.style.fontFamily =
    'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial';

  const toast = makeToast();
  const zoomModal = createZoomModal();

  // Left list
  const left = document.createElement("div");
  left.style.width = "360px";
  left.style.padding = "12px";
  left.style.boxSizing = "border-box";
  left.style.overflow = "auto";
  left.style.borderRight = "1px solid #232323";
  root.appendChild(left);

  // Main content
  const main = document.createElement("div");
  main.style.flex = "1";
  main.style.padding = "12px";
  main.style.boxSizing = "border-box";
  main.style.overflow = "auto";
  root.appendChild(main);

  const header = document.createElement("div");
  header.innerHTML = `<h2 style="margin:0 0 10px 0;">Tileset Editor</h2>`;
  left.appendChild(header);

  const search = document.createElement("input");
  search.placeholder = "Search filename…";
  search.style.width = "100%";
  search.style.marginBottom = "10px";
  // style applied in render_list via CSS? keep simple:
  search.style.padding = "8px";
  search.style.borderRadius = "10px";
  search.style.border = "1px solid #2f2f2f";
  search.style.background = "#0c0c0c";
  search.style.color = "#e6e6e6";
  left.appendChild(search);

  const list = document.createElement("div");
  left.appendChild(list);

  const status = document.createElement("div");
  status.style.marginTop = "10px";
  status.style.fontSize = "12px";
  status.style.opacity = "0.85";
  left.appendChild(status);

  // Load initial API state
  let api: ApiState;
  try {
    api = await fetchApiState();
  } catch (e) {
    main.innerHTML = `<p style="opacity:0.85;">Failed to load <code>/api/tileset</code>.</p>`;
    return;
  }

  // Enforce v2 from server; UI assumes v2 only
  if (api.tileset?.meta?.version !== 2) {
    // server should prevent this; fallback
    api.tileset = { meta: { version: 2, tileSize: 16 }, tiles: [] };
  }

  const state: TilesetEditorState = {
    api,
    byFile: rebuildIndex(api.tileset),
    selectedFile: api.images[0] ?? null,
    compareFile: null,
    draft: null,
    compat: { open: false },
  };
  state.keywordIndex = buildKeywordIndex(state.api.tileset.tiles);
  if (state.selectedFile) {
    state.draft = structuredClone(
      state.byFile.get(state.selectedFile) ?? emptyTile(state.selectedFile)
    );
  }

  const rerenderAll = () => {
    renderList({
      listEl: list,
      statusEl: status,
      searchEl: search,
      state,
      onSelect: () => rerenderAll(),
      onCompare: () => rerenderAll(),
    });

    renderEditor({
      mainEl: main,
      state,
      zoomModal,
      onStateChanged: () => rerenderAll(),
      onSave: async (draft: TileV2) => {
        try {
          const resp = await fetch("/api/tileset/tile", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(draft),
          });

          if (!resp.ok) {
            toast.show(`Save failed (${resp.status})`);
            return;
          }

          const updated = (await resp.json()) as {
            ok: true;
            tileset: TilesetV2;
          };

          state.api.tileset = updated.tileset;
          state.byFile = rebuildIndex(updated.tileset);

          // keep draft synced (server may clean)
          state.draft = structuredClone(state.byFile.get(draft.file) ?? draft);
          state.keywordIndex = buildKeywordIndex(state.api.tileset.tiles);
          toast.show("Saved");
          rerenderAll();
        } catch {
          toast.show("Save failed (network)");
        }
      },
    });
  };

  search.oninput = () => rerenderAll();
  rerenderAll();
}
