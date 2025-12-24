import { applyDarkBase, makeToast } from "../components/dom";
import { createZoomModal } from "../components/zoom_modal";
import type { ApiState } from "../components/types";
import { rebuildIndex, emptyTile } from "../components/state";
import type { TilesetEditorState } from "../components/state";
import { renderList } from "../components/render_list";
import { renderEditor } from "../components/render_editor";
import type { TileV2, TilesetV2 } from "../components/types";
import { buildKeywordIndex } from "../components/keyword_index";
import { validateTileset } from "../components/validate_tileset";
import { styleButton } from "../components/dom";

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
  header.style.display = "flex";
  header.style.justifyContent = "space-between";
  header.style.alignItems = "center";
  header.style.marginBottom = "10px";
  header.innerHTML = `<h2 style="margin:0;">Tileset Editor</h2>`;

  const validateBtn = document.createElement("button");
  validateBtn.textContent = "Validate";
  styleButton(validateBtn, "ghost");
  validateBtn.style.padding = "4px 8px";
  validateBtn.style.fontSize = "12px";

  validateBtn.onclick = () => {
    const result = validateTileset(state.api.tileset);
    if (result.ok) {
      toast.show("✅ Tileset is perfectly symmetrical!");
    } else {
      // Log to console for detailed reading, show alert for immediate feedback
      console.error("Tileset Validation Failed:", result.errors);
      alert(
        `Found ${result.errors.length} symmetry issues. Check console for details.`
      );
      toast.show(`❌ ${result.errors.length} Issues Found`);
    }
  };

  header.appendChild(validateBtn);
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
    const validation = validateTileset(state.api.tileset);
    validateBtn.style.borderColor = validation.ok ? "" : "#ff4444";
    validateBtn.textContent = validation.ok ? "Validate" : "⚠️ Issues";

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
