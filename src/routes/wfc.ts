export function renderWfcRoute(root: HTMLElement) {
  root.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.style.border = "1px solid #232323";
  wrap.style.borderRadius = "16px";
  wrap.style.background = "#0f0f0f";
  wrap.style.padding = "16px";

  const h = document.createElement("h2");
  h.textContent = "WFC Generator";
  h.style.margin = "0 0 8px 0";
  h.style.fontSize = "16px";
  h.style.letterSpacing = "0.02em";

  const p = document.createElement("p");
  p.style.margin = "0 0 14px 0";
  p.style.opacity = "0.8";
  p.style.fontSize = "13px";
  p.textContent =
    "This page will host generation controls and preview output. Tileset is loaded from tileset.json via your dev API.";

  const hint = document.createElement("div");
  hint.style.border = "1px dashed #2f2f2f";
  hint.style.borderRadius = "14px";
  hint.style.padding = "12px";
  hint.style.background = "#0b0b0b";
  hint.style.fontSize = "12px";
  hint.style.opacity = "0.85";
  hint.innerHTML = `
    <div style="font-weight:600; margin-bottom:6px;">Next steps</div>
    <ul style="margin:0; padding-left:18px; line-height:1.55;">
      <li>Load tileset + images list (same as Tileset Editor)</li>
      <li>Define generator settings (grid size, seed, constraints)</li>
      <li>Run WFC and render output grid (canvas or DOM)</li>
      <li>Inspect contradictions / debug adjacency</li>
    </ul>
  `;

  wrap.appendChild(h);
  wrap.appendChild(p);
  wrap.appendChild(hint);
  root.appendChild(wrap);
}
