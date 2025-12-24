import type { TileV2 } from "./types";
import type { TilesetEditorState } from "./state";
import type { ZoomModal } from "./zoom_modal";
import { renderPreviewsColumn } from "./render_previews";
import { renderTileForm } from "./render_form";
import { renderCompatPanel } from "./compat_panel";

export function renderEditor(opts: {
  mainEl: HTMLElement;
  state: TilesetEditorState;
  zoomModal: ZoomModal;
  onStateChanged: () => void;
  onSave: (draft: TileV2) => Promise<void>;
}) {
  const { mainEl, state, zoomModal, onStateChanged, onSave } = opts;
  mainEl.innerHTML = "";

  const draft = state.draft;
  if (!draft) {
    mainEl.innerHTML = `<p style="opacity:0.85;">No tiles found in <code>/tiles</code>.</p>`;
    return;
  }

  const top = document.createElement("div");
  top.style.display = "grid";
  top.style.gridTemplateColumns = "420px 1fr";
  top.style.gap = "16px";
  mainEl.appendChild(top);

  const previewsCol = document.createElement("div");
  top.appendChild(previewsCol);

  const formCol = document.createElement("div");
  top.appendChild(formCol);

  renderPreviewsColumn({
    container: previewsCol,
    state,
    zoomModal,
    onStateChanged,
  });

  renderTileForm({
    container: formCol,
    state,
    onStateChanged,
    onSave,
  });

  const compatHost = document.createElement("div");
  compatHost.style.marginTop = "12px";
  formCol.appendChild(compatHost);

  renderCompatPanel({
    container: compatHost,
    state,
    onClose: () => {
      state.compat = { open: false };
      state.activeKeyword = undefined;
      onStateChanged();
    },
    onPreviewTile: (file) => {
      state.compareFile = file;
      onStateChanged();
    },
    onSelectTile: (file) => {
      state.selectedFile = file;
      state.draft = structuredClone(state.byFile.get(file) ?? state.draft);
      onStateChanged();
    },
  });
}
