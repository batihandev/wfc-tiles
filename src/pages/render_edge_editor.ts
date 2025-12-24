import { styleButton, styleInput, stylePanel } from "./dom";
import type { Dir, EdgeRule } from "./types";
import type { TilesetEditorState } from "./state";
import { suggest } from "./keyword_index";
import type { SuggestionsModal } from "./suggestions_modal";

function normKey(k: string) {
  return (k ?? "").trim().toLowerCase();
}

function makeSuggestionSlot(): HTMLDivElement {
  const slot = document.createElement("div");
  slot.style.height = "40px"; // fixed area; no layout shifts
  slot.style.display = "flex";
  slot.style.alignItems = "center";
  slot.style.gap = "8px";
  slot.style.marginTop = "6px";
  slot.style.overflow = "hidden";
  return slot;
}

function renderSuggestionSlot(opts: {
  slot: HTMLElement;
  mode: "idle" | "active" | "empty";
  label: Dir;
  prefix: string;
  suggestions: string[];
  onPick: (kw: string) => void;
  onMore: () => void;
}) {
  const { slot, mode, suggestions, onPick, onMore } = opts;
  slot.innerHTML = "";

  const hint = document.createElement("div");
  hint.style.fontSize = "11px";
  hint.style.opacity = "0.65";
  hint.style.whiteSpace = "nowrap";
  hint.style.overflow = "hidden";
  hint.style.textOverflow = "ellipsis";

  if (mode === "idle") {
    hint.textContent = "Unselected / unknown";
    slot.appendChild(hint);
    return;
  }

  if (mode === "empty") {
    hint.textContent = "No suggestions";
    slot.appendChild(hint);
    return;
  }

  // active: show 2 chips + more
  const chips = suggestions.slice(0, 2);
  if (chips.length === 0) {
    hint.textContent = "No suggestions";
    slot.appendChild(hint);
    return;
  }

  for (const s of chips) {
    const b = document.createElement("button");
    b.textContent = s;
    styleButton(b, "ghost");
    b.style.padding = "4px 8px";
    b.style.fontSize = "11px";
    b.style.opacity = "0.92";
    b.onclick = () => onPick(s);
    slot.appendChild(b);
  }

  const more = document.createElement("button");
  more.textContent = "More…";
  styleButton(more, "ghost");
  more.style.padding = "4px 8px";
  more.style.fontSize = "11px";
  more.style.opacity = "0.85";
  more.onclick = onMore;
  slot.appendChild(more);
}

export function renderEdgeEditor(opts: {
  container: HTMLElement;
  label: Dir;
  rules: EdgeRule[];
  state: TilesetEditorState;
  suggestionsModal: SuggestionsModal;
  onChange: () => void;
  onOpenCompat: (dir: Dir, keyword: string) => void;
}) {
  const {
    container,
    label,
    rules,
    state,
    suggestionsModal,
    onChange,
    onOpenCompat,
  } = opts;

  const wrap = document.createElement("div");
  stylePanel(wrap);
  wrap.style.padding = "10px";
  wrap.style.marginBottom = "10px";

  const title = document.createElement("div");
  title.style.display = "flex";
  title.style.alignItems = "center";
  title.style.justifyContent = "space-between";
  title.style.marginBottom = "8px";

  const leftTitle = document.createElement("div");
  leftTitle.innerHTML = `<strong style="text-transform:uppercase; letter-spacing:0.06em;">${label}</strong>`;
  title.appendChild(leftTitle);

  const addBtn = document.createElement("button");
  addBtn.textContent = "+ Add";
  styleButton(addBtn, "ok");
  addBtn.style.padding = "6px 10px";
  addBtn.style.fontSize = "12px";
  addBtn.onclick = () => {
    rules.push({ key: "", weight: undefined });
    onChange();
  };

  title.appendChild(addBtn);
  wrap.appendChild(title);

  if (rules.length === 0) {
    const empty = document.createElement("div");
    empty.style.opacity = "0.7";
    empty.style.fontSize = "12px";
    empty.textContent =
      "No rules yet. Add keywords that can connect on this edge.";
    wrap.appendChild(empty);
  }

  const dirSuggestions = state.keywordIndex?.suggestionsByDir?.[label] ?? [];
  const globalSuggestions = state.keywordIndex?.allSuggestions ?? [];

  for (let i = 0; i < rules.length; i++) {
    const row = document.createElement("div");
    row.style.display = "grid";
    row.style.gridTemplateColumns = "1fr 120px 52px";
    row.style.gap = "8px";
    row.style.alignItems = "start";
    row.style.marginBottom = "8px";

    const keyWrap = document.createElement("div");
    keyWrap.style.display = "flex";
    keyWrap.style.flexDirection = "column";

    const key = document.createElement("input");
    key.placeholder = "keyword (e.g. grass, muddy-grass, dirt)";
    key.value = rules[i].key ?? "";
    styleInput(key);

    // fixed suggestion slot, always present
    const slot = makeSuggestionSlot();

    // state
    let focused = false;

    const computeMatches = () => {
      const prefix = key.value ?? "";
      const d = suggest(prefix, dirSuggestions, 32);
      const g = suggest(prefix, globalSuggestions, 32);
      // Prefer per-edge suggestions; fallback to global.
      const list = d.length > 0 ? d : g;
      return list;
    };

    const syncSlot = () => {
      const prefix = key.value ?? "";
      const norm = normKey(prefix);

      // If nothing typed and not focused -> idle
      if (!focused && !norm) {
        renderSuggestionSlot({
          slot,
          mode: "idle",
          label,
          prefix,
          suggestions: [],
          onPick: () => {},
          onMore: () => {},
        });
        return;
      }

      const matches = computeMatches();
      if (matches.length === 0) {
        renderSuggestionSlot({
          slot,
          mode: "empty",
          label,
          prefix,
          suggestions: [],
          onPick: () => {},
          onMore: () => {},
        });
        return;
      }

      renderSuggestionSlot({
        slot,
        mode: "active",
        label,
        prefix,
        suggestions: matches,
        onPick: (kw) => {
          rules[i].key = kw;
          key.value = kw;
          focused = false;
          syncSlot();
          onChange();
        },
        onMore: () => {
          suggestionsModal.open({
            title: `Suggestions for ${label.toUpperCase()}`,
            suggestions: matches,
            initialQuery: key.value,
            onPick: (kw) => {
              rules[i].key = kw;
              key.value = kw;
              focused = false;
              syncSlot();
              onChange();
            },
          });
        },
      });
    };

    key.onfocus = () => {
      focused = true;
      syncSlot();
    };
    key.onblur = () => {
      window.setTimeout(() => {
        focused = false;
        syncSlot();
      }, 120);
    };

    key.oninput = () => {
      rules[i].key = key.value;
      syncSlot();
    };

    key.ondblclick = () => {
      const k = normKey(key.value);
      if (k) onOpenCompat(label, k);
    };

    keyWrap.appendChild(key);
    keyWrap.appendChild(slot);

    // initial slot render
    syncSlot();

    const w = document.createElement("input");
    w.placeholder = "weight";
    w.value =
      rules[i].weight === undefined || rules[i].weight === null
        ? ""
        : String(rules[i].weight);
    w.type = "number";
    w.step = "0.05";
    w.min = "0";
    styleInput(w);
    w.oninput = () => {
      const v = Number(w.value);
      rules[i].weight = Number.isFinite(v) && v > 0 ? v : undefined;
    };

    const del = document.createElement("button");
    del.textContent = "×";
    styleButton(del, "danger");
    del.style.width = "52px";
    del.onclick = () => {
      rules.splice(i, 1);
      onChange();
    };

    row.appendChild(keyWrap);
    row.appendChild(w);
    row.appendChild(del);
    wrap.appendChild(row);

    // Keep your compat chip (optional)
    const k = normKey(rules[i].key);
    if (k) {
      const chipRow = document.createElement("div");
      chipRow.style.display = "flex";
      chipRow.style.gap = "8px";
      chipRow.style.margin = "-2px 0 10px 0";
      chipRow.style.paddingLeft = "2px";

      const chip = document.createElement("button");
      chip.textContent = `Find tiles with “${k}” on ${label.toUpperCase()}`;
      styleButton(chip, "warn");
      chip.style.padding = "5px 8px";
      chip.style.fontSize = "11px";
      chip.style.opacity = "0.9";
      chip.onclick = () => onOpenCompat(label, k);

      chipRow.appendChild(chip);
      wrap.appendChild(chipRow);
    }
  }

  container.appendChild(wrap);
}
