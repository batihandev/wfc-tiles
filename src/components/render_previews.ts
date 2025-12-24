import { baseName, styleButton, stylePanel } from "./dom";
import type { TilesetEditorState } from "./state";
import type { ZoomModal } from "./zoom_modal";

function makeFitPreviewBox(opts: {
  title: string;
  imgSrc: string | null;
  heightPx: number;
  onZoom?: () => void;
  rightControls?: HTMLElement;
}) {
  const box = document.createElement("div");
  stylePanel(box);
  box.style.padding = "12px";

  const head = document.createElement("div");
  head.style.display = "flex";
  head.style.alignItems = "center";
  head.style.justifyContent = "space-between";
  head.style.marginBottom = "10px";

  const titleEl = document.createElement("div");
  titleEl.innerHTML = `<strong>${opts.title}</strong>`;
  head.appendChild(titleEl);

  const controls = document.createElement("div");
  controls.style.display = "flex";
  controls.style.gap = "8px";
  controls.style.alignItems = "center";

  if (opts.onZoom) {
    const zoomBtn = document.createElement("button");
    zoomBtn.textContent = "Zoom…";
    styleButton(zoomBtn, "ghost");
    zoomBtn.style.padding = "6px 10px";
    zoomBtn.style.fontSize = "12px";
    zoomBtn.onclick = opts.onZoom;
    controls.appendChild(zoomBtn);
  }

  if (opts.rightControls) controls.appendChild(opts.rightControls);

  head.appendChild(controls);
  box.appendChild(head);

  const wrap = document.createElement("div");
  wrap.style.border = "1px solid #232323";
  wrap.style.borderRadius = "14px";
  wrap.style.background = "#0b0b0b";
  wrap.style.overflow = "hidden";
  wrap.style.height = `${opts.heightPx}px`;
  wrap.style.padding = "10px"; // padding to see corners cleanly
  wrap.style.boxSizing = "border-box";
  box.appendChild(wrap);

  if (!opts.imgSrc) {
    const hint = document.createElement("div");
    hint.style.opacity = "0.75";
    hint.style.fontSize = "12px";
    hint.style.padding = "10px";
    hint.style.textAlign = "center";
    hint.textContent = "No image selected.";
    wrap.appendChild(hint);
    return box;
  }

  // IMPORTANT: upscale to fill the box (contain)
  const img = document.createElement("img");
  img.src = opts.imgSrc;
  img.style.imageRendering = "pixelated";
  img.style.width = "100%";
  img.style.height = "100%";
  img.style.objectFit = "contain";
  img.style.display = "block";
  img.style.userSelect = "none";
  img.draggable = false;
  img.style.cursor = opts.onZoom ? "zoom-in" : "default";
  if (opts.onZoom) img.onclick = opts.onZoom;

  wrap.appendChild(img);
  return box;
}

export function renderPreviewsColumn(opts: {
  container: HTMLElement;
  state: TilesetEditorState;
  zoomModal: ZoomModal;
  onStateChanged: () => void;
}) {
  const { container, state, zoomModal, onStateChanged } = opts;
  container.innerHTML = "";

  const draft = state.draft;
  if (!draft) return;

  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.gap = "12px";

  const compareControls = document.createElement("div");
  const clearBtn = document.createElement("button");
  clearBtn.textContent = "Clear";
  styleButton(clearBtn, "danger");
  clearBtn.style.padding = "6px 10px";
  clearBtn.style.fontSize = "12px";
  clearBtn.onclick = () => {
    state.compareFile = null;
    onStateChanged();
  };
  compareControls.appendChild(clearBtn);

  const primarySrc = "/" + draft.file;
  const secondarySrc = state.compareFile ? "/" + state.compareFile : null;

  const openZoom = () => {
    zoomModal.open({
      leftTitle: baseName(draft.file),
      leftSrc: primarySrc,
      rightTitle: state.compareFile ? baseName(state.compareFile) : undefined,
      rightSrc: secondarySrc ?? undefined,
    });
  };

  container.appendChild(
    makeFitPreviewBox({
      title: baseName(draft.file),
      imgSrc: primarySrc,
      heightPx: 320,
      onZoom: openZoom,
    })
  );

  container.appendChild(
    makeFitPreviewBox({
      title: "Secondary Preview",
      imgSrc: secondarySrc,
      heightPx: 320,
      rightControls: compareControls,
      onZoom: secondarySrc ? openZoom : undefined,
    })
  );
}
