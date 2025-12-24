export function renderHomeRoute(root: HTMLElement) {
  const wrap = document.createElement("div");
  wrap.style.padding = "16px";
  wrap.innerHTML = `
    <h2 style="margin:0 0 8px 0;">WFC Tools</h2>
    <p style="margin:0 0 12px 0;">
      <a data-link href="/tileset">Open Tileset Editor</a>
    </p>
  `;
  root.appendChild(wrap);
}
