import { styleButton, styleInput, stylePanel } from "./dom";

export type SuggestionsModalOpenOpts = {
  title: string;
  suggestions: string[];
  initialQuery?: string;
  onPick: (kw: string) => void;
};

export type SuggestionsModal = {
  open: (opts: SuggestionsModalOpenOpts) => void;
};

export function createSuggestionsModal(): SuggestionsModal {
  const overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.background = "rgba(0,0,0,0.7)";
  overlay.style.display = "none";
  overlay.style.zIndex = "999999";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";

  const panel = document.createElement("div");
  stylePanel(panel);
  panel.style.width = "min(720px, 92vw)";
  panel.style.height = "min(560px, 84vh)";
  panel.style.display = "grid";
  panel.style.gridTemplateRows = "auto auto 1fr auto";
  panel.style.overflow = "hidden";
  panel.style.padding = "0";

  const head = document.createElement("div");
  head.style.display = "flex";
  head.style.alignItems = "center";
  head.style.justifyContent = "space-between";
  head.style.padding = "10px 12px";
  head.style.borderBottom = "1px solid #232323";

  const titleEl = document.createElement("div");
  titleEl.style.fontWeight = "600";
  titleEl.style.fontSize = "13px";
  titleEl.style.opacity = "0.95";
  head.appendChild(titleEl);

  const close = document.createElement("button");
  close.textContent = "Close";
  styleButton(close, "danger");
  close.style.padding = "6px 10px";
  close.onclick = () => (overlay.style.display = "none");
  head.appendChild(close);

  const searchRow = document.createElement("div");
  searchRow.style.padding = "10px 12px";
  searchRow.style.borderBottom = "1px solid #232323";
  searchRow.style.display = "flex";
  searchRow.style.gap = "10px";
  searchRow.style.alignItems = "center";

  const search = document.createElement("input");
  search.placeholder = "Filter keywords…";
  styleInput(search);
  search.style.width = "100%";

  const count = document.createElement("div");
  count.style.fontSize = "12px";
  count.style.opacity = "0.75";
  count.style.minWidth = "70px";
  count.style.textAlign = "right";

  searchRow.appendChild(search);
  searchRow.appendChild(count);

  const body = document.createElement("div");
  body.style.padding = "10px 12px";
  body.style.overflow = "auto";

  const foot = document.createElement("div");
  foot.style.padding = "10px 12px";
  foot.style.borderTop = "1px solid #232323";
  foot.style.fontSize = "12px";
  foot.style.opacity = "0.75";
  foot.textContent = "Tip: press Esc to close.";

  panel.appendChild(head);
  panel.appendChild(searchRow);
  panel.appendChild(body);
  panel.appendChild(foot);

  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) overlay.style.display = "none";
  });

  window.addEventListener("keydown", (e) => {
    if (overlay.style.display !== "none" && e.key === "Escape") {
      overlay.style.display = "none";
    }
  });

  let current: SuggestionsModalOpenOpts | null = null;

  function renderList() {
    if (!current) return;
    body.innerHTML = "";

    const q = (search.value ?? "").trim().toLowerCase();
    const items = q
      ? current.suggestions.filter((s) => s.toLowerCase().includes(q))
      : current.suggestions;

    count.textContent = `${items.length}`;

    const grid = document.createElement("div");
    grid.style.display = "grid";
    grid.style.gridTemplateColumns = "repeat(auto-fill, minmax(180px, 1fr))";
    grid.style.gap = "8px";

    for (const s of items) {
      const b = document.createElement("button");
      b.textContent = s;
      styleButton(b, "ghost");
      b.style.textAlign = "left";
      b.style.padding = "8px 10px";
      b.style.fontSize = "12px";
      b.onclick = () => {
        current?.onPick(s);
        overlay.style.display = "none";
      };
      grid.appendChild(b);
    }

    body.appendChild(grid);
  }

  search.addEventListener("input", renderList);

  return {
    open: (opts: SuggestionsModalOpenOpts) => {
      current = opts;
      titleEl.textContent = opts.title;
      search.value = opts.initialQuery ?? "";
      overlay.style.display = "flex";
      renderList();
      search.focus();
      search.select();
    },
  };
}
