import { styleButton } from "./dom";

export type ZoomModalOpenOpts = {
  leftTitle: string;
  leftSrc: string;
  rightTitle?: string;
  rightSrc?: string;
  /**
   * Default zoom relative to "fit-to-viewport" size.
   * 2 means: start at 2x the fitted size.
   */
  defaultFitMultiplier?: number;
};

export type ZoomModal = {
  open: (opts: ZoomModalOpenOpts) => void;
};

export function createZoomModal(): ZoomModal {
  const overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.background = "rgba(0,0,0,0.7)";
  overlay.style.display = "none";
  overlay.style.zIndex = "999999";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";

  const panel = document.createElement("div");
  panel.style.width = "min(1100px, 94vw)";
  panel.style.height = "min(760px, 88vh)";
  panel.style.border = "1px solid #2f2f2f";
  panel.style.borderRadius = "16px";
  panel.style.background = "#0f0f0f";
  panel.style.display = "grid";
  panel.style.gridTemplateRows = "auto 1fr auto";
  panel.style.overflow = "hidden";

  const head = document.createElement("div");
  head.style.display = "flex";
  head.style.alignItems = "center";
  head.style.justifyContent = "space-between";
  head.style.padding = "10px 12px";
  head.style.borderBottom = "1px solid #232323";

  const title = document.createElement("div");
  title.style.fontWeight = "600";
  title.style.fontSize = "13px";
  title.style.opacity = "0.95";
  title.textContent = "Zoom Preview";
  head.appendChild(title);

  const close = document.createElement("button");
  close.textContent = "Close";
  styleButton(close, "danger");
  close.style.padding = "6px 10px";
  close.onclick = () => (overlay.style.display = "none");
  head.appendChild(close);

  const body = document.createElement("div");
  body.style.display = "grid";
  body.style.gridTemplateColumns = "1fr 1fr";
  body.style.gap = "10px";
  body.style.padding = "10px";
  body.style.overflow = "hidden";

  function makeViewport() {
    const vp = document.createElement("div");
    vp.style.border = "1px solid #232323";
    vp.style.borderRadius = "14px";
    vp.style.background = "#0b0b0b";
    vp.style.overflow = "hidden";
    vp.style.display = "flex";
    vp.style.flexDirection = "column";

    const label = document.createElement("div");
    label.style.fontSize = "12px";
    label.style.opacity = "0.8";
    label.style.padding = "10px 12px";
    label.style.borderBottom = "1px solid #1f1f1f";

    // Scroller area (keeps label + footer always visible)
    const scroller = document.createElement("div");
    scroller.style.flex = "1";
    scroller.style.overflow = "auto";
    scroller.style.padding = "14px";
    scroller.style.boxSizing = "border-box";

    // Frame for fitting
    const frame = document.createElement("div");
    frame.style.width = "100%";
    frame.style.height = "100%";
    frame.style.display = "flex";
    frame.style.alignItems = "center";
    frame.style.justifyContent = "center";
    frame.style.minHeight = "100%";

    const img = document.createElement("img");
    img.style.imageRendering = "pixelated";
    img.style.display = "block";
    img.style.userSelect = "none";
    img.draggable = false;

    // We'll set width/height in applyZoom()
    img.style.maxWidth = "none";
    img.style.maxHeight = "none";

    frame.appendChild(img);
    scroller.appendChild(frame);

    vp.appendChild(label);
    vp.appendChild(scroller);

    return { vp, label, img, scroller };
  }

  const leftVp = makeViewport();
  const rightVp = makeViewport();
  body.appendChild(leftVp.vp);
  body.appendChild(rightVp.vp);

  const foot = document.createElement("div");
  foot.style.display = "flex";
  foot.style.alignItems = "center";
  foot.style.gap = "10px";
  foot.style.padding = "10px 12px";
  foot.style.borderTop = "1px solid #232323";

  const zoomLbl = document.createElement("div");
  zoomLbl.textContent = "Zoom";
  zoomLbl.style.fontSize = "12px";
  zoomLbl.style.opacity = "0.85";

  const zoom = document.createElement("input");
  zoom.type = "range";
  zoom.min = "1";
  zoom.max = "30";
  zoom.value = "10";
  zoom.style.width = "100%";

  const zoomValue = document.createElement("div");
  zoomValue.style.fontSize = "12px";
  zoomValue.style.opacity = "0.85";
  zoomValue.style.minWidth = "56px";
  zoomValue.style.textAlign = "right";

  foot.appendChild(zoomLbl);
  foot.appendChild(zoom);
  foot.appendChild(zoomValue);

  panel.appendChild(head);
  panel.appendChild(body);
  panel.appendChild(foot);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) overlay.style.display = "none";
  });

  function setImage(imgEl: HTMLImageElement, src: string | null) {
    if (!src) {
      imgEl.src = "";
      imgEl.style.display = "none";
      imgEl.dataset.nw = "";
      imgEl.dataset.nh = "";
      return;
    }
    imgEl.style.display = "block";
    imgEl.src = src;
  }

  // Fit the image into its scroller viewport (minus padding), then multiply by factor.
  function applyFitScaled(
    img: HTMLImageElement,
    scroller: HTMLElement,
    factor: number
  ) {
    const nw = Number(img.naturalWidth || 0);
    const nh = Number(img.naturalHeight || 0);
    if (!nw || !nh) return;

    // scroller padding is 14px all around, but clientWidth already includes it.
    // We'll compute an inner available size by subtracting padding manually.
    const pad = 14 * 2;
    const availW = Math.max(1, scroller.clientWidth - pad);
    const availH = Math.max(1, scroller.clientHeight - pad);

    const fit = Math.min(availW / nw, availH / nh);
    const scale = fit * factor;

    img.style.width = `${Math.round(nw * scale)}px`;
    img.style.height = `${Math.round(nh * scale)}px`;
  }

  function applyZoomWithFactor(factor: number) {
    zoomValue.textContent = `${Math.round(factor * 100)}%`;

    if (leftVp.img.style.display !== "none") {
      applyFitScaled(leftVp.img, leftVp.scroller, factor);
    }
    if (rightVp.img.style.display !== "none") {
      applyFitScaled(rightVp.img, rightVp.scroller, factor);
    }
  }

  zoom.addEventListener("input", () => {
    const v = Number(zoom.value);
    // Map slider to multiplier; start around 2.0 at default
    const factor = 0.5 + v * 0.2; // 1 -> 0.7, 10 -> 2.5, 30 -> 6.5
    applyZoomWithFactor(factor);
  });

  // keyboard close
  window.addEventListener("keydown", (e) => {
    if (overlay.style.display !== "none" && e.key === "Escape") {
      overlay.style.display = "none";
    }
  });

  // Refit when window changes (so "fit" stays correct)
  window.addEventListener("resize", () => {
    if (overlay.style.display === "none") return;
    const v = Number(zoom.value);
    const factor = 0.5 + v * 0.2;
    applyZoomWithFactor(factor);
  });

  return {
    open: (opts: ZoomModalOpenOpts) => {
      leftVp.label.textContent = opts.leftTitle;
      rightVp.label.textContent = opts.rightTitle ?? "Secondary";

      setImage(leftVp.img, opts.leftSrc);
      setImage(rightVp.img, opts.rightSrc ?? null);

      body.style.gridTemplateColumns = opts.rightSrc ? "1fr 1fr" : "1fr";
      rightVp.vp.style.display = opts.rightSrc ? "flex" : "none";

      overlay.style.display = "flex";

      // Wait for natural sizes then apply default "fit * 2"
      const defaultMult = opts.defaultFitMultiplier ?? 0.8;

      const ensure = () => {
        const leftReady =
          leftVp.img.style.display === "none" ||
          (leftVp.img.complete && leftVp.img.naturalWidth > 0);
        const rightReady =
          rightVp.img.style.display === "none" ||
          (rightVp.img.complete && rightVp.img.naturalWidth > 0);

        if (!leftReady || !rightReady) {
          requestAnimationFrame(ensure);
          return;
        }

        // Set slider near where factor≈defaultMult
        // factor = 0.5 + v*0.2  => v = (factor-0.5)/0.2
        const targetV = Math.round((defaultMult - 0.5) / 0.2);
        zoom.value = String(Math.max(1, Math.min(30, targetV)));

        const v = Number(zoom.value);
        const factor = 0.5 + v * 0.2;
        applyZoomWithFactor(factor);
      };

      ensure();
    },
  };
}
