import { baseName, styleButton, stylePanel } from "./dom";
import type { Dir, TileV2 } from "./types";
import type { TilesetEditorState } from "./state";

export function renderCompatPanel(opts: {
  container: HTMLElement;
  state: TilesetEditorState;
  onSelectTile: (file: string) => void; // jump to tile
  onPreviewTile: (file: string) => void; // set compareFile
  onClose: () => void;
}) {
  const { container, state, onSelectTile, onPreviewTile, onClose } = opts;
  container.innerHTML = "";

  if (!state.compat.open || !state.keywordIndex) return;

  const { dir, keyword } = state.compat;

  const box = document.createElement("div");
  stylePanel(box);
  box.style.padding = "12px";
  box.style.marginBottom = "12px";

  const head = document.createElement("div");
  head.style.display = "flex";
  head.style.alignItems = "center";
  head.style.justifyContent = "space-between";
  head.style.marginBottom = "10px";

  const title = document.createElement("div");
  title.innerHTML = `<strong>Compatibility</strong><div style="opacity:.8;font-size:12px;margin-top:2px;">Edge <code>${dir.toUpperCase()}</code> contains keyword <code>${keyword}</code></div>`;
  head.appendChild(title);

  const close = document.createElement("button");
  close.textContent = "Close";
  styleButton(close, "danger");
  close.style.padding = "6px 10px";
  close.style.fontSize = "12px";
  close.onclick = onClose;
  head.appendChild(close);

  box.appendChild(head);

  const list = document.createElement("div");
  list.style.display = "flex";
  list.style.flexDirection = "column";
  list.style.gap = "8px";

  const hits: TileV2[] =
    state.keywordIndex.tilesByKeywordByDir[dir].get(keyword) ?? [];

  const summary = document.createElement("div");
  summary.style.opacity = "0.8";
  summary.style.fontSize = "12px";
  summary.style.marginBottom = "8px";
  summary.textContent = `Matches: ${hits.length}`;
  box.appendChild(summary);

  if (hits.length === 0) {
    const empty = document.createElement("div");
    empty.style.opacity = "0.75";
    empty.style.fontSize = "12px";
    empty.textContent = "No tiles currently use this keyword on that edge.";
    list.appendChild(empty);
  }

  for (const t of hits) {
    const row = document.createElement("div");
    row.style.display = "grid";
    row.style.gridTemplateColumns = "1fr auto auto";
    row.style.gap = "8px";
    row.style.alignItems = "center";
    row.style.padding = "8px";
    row.style.border = "1px solid #232323";
    row.style.borderRadius = "12px";
    row.style.background = "#0b0b0b";

    const name = document.createElement("div");
    name.style.fontSize = "12px";
    name.style.opacity = "0.95";
    name.style.whiteSpace = "nowrap";
    name.style.overflow = "hidden";
    name.style.textOverflow = "ellipsis";
    name.textContent = baseName(t.file);

    const btnPreview = document.createElement("button");
    btnPreview.textContent = "Preview";
    styleButton(btnPreview, "ghost");
    btnPreview.style.padding = "6px 10px";
    btnPreview.style.fontSize = "12px";
    btnPreview.onclick = () => onPreviewTile(t.file);

    const btnGo = document.createElement("button");
    btnGo.textContent = "Go";
    styleButton(btnGo, "primary");
    btnGo.style.padding = "6px 10px";
    btnGo.style.fontSize = "12px";
    btnGo.onclick = () => onSelectTile(t.file);

    row.appendChild(name);
    row.appendChild(btnPreview);
    row.appendChild(btnGo);

    list.appendChild(row);
  }

  box.appendChild(list);
  container.appendChild(box);
}
