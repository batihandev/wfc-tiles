// src/components/pages/dom.ts

export type Tone = "neutral" | "info" | "ok" | "warn" | "danger" | "todo";

const TOKENS = {
  bg: "#0b0b0b",
  panelBg: "#0f0f0f",
  panelBorder: "#232323",
  inputBg: "#0c0c0c",
  border: "#2f2f2f",
  text: "#e6e6e6",
  textMuted: "#a9a9a9",
  shadow: "0 8px 22px rgba(0,0,0,0.35)",

  // semantic accents
  ok: "#2ea043", // green-ish
  warn: "#d29922", // amber
  danger: "#f85149", // red
  info: "#58a6ff", // blue
  todo: "#9da7b3", // gray-blue
};

function hexToRgba(hex: string, a: number) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function toneColor(tone: Tone) {
  switch (tone) {
    case "ok":
      return TOKENS.ok;
    case "warn":
      return TOKENS.warn;
    case "danger":
      return TOKENS.danger;
    case "info":
      return TOKENS.info;
    case "todo":
      return TOKENS.todo;
    default:
      return TOKENS.border;
  }
}

export function applyDarkBase() {
  document.documentElement.style.colorScheme = "dark";
  document.body.style.margin = "0";
  document.body.style.background = TOKENS.bg;
  document.body.style.color = TOKENS.text;
  document.body.style.fontFamily =
    'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial';
}

export function stylePanel(
  el: HTMLElement,
  opts?: { tone?: Tone; padded?: boolean }
) {
  const tone = opts?.tone ?? "neutral";
  el.style.border = `1px solid ${
    tone === "neutral" ? TOKENS.panelBorder : toneColor(tone)
  }`;
  el.style.borderRadius = "14px";
  el.style.background = TOKENS.panelBg;
  el.style.boxShadow = TOKENS.shadow;

  if (opts?.padded) el.style.padding = "12px";
}

export function styleInput(el: HTMLInputElement | HTMLTextAreaElement) {
  el.style.padding = "8px";
  el.style.height = "34px";
  el.style.borderRadius = "10px";
  el.style.border = `1px solid ${TOKENS.border}`;
  el.style.background = TOKENS.inputBg;
  el.style.color = TOKENS.text;
  el.style.outline = "none";
  el.style.boxSizing = "border-box";
}

export function styleButton(
  el: HTMLButtonElement,
  kind: "primary" | "ghost" | "danger" | "ok" | "warn" = "ghost"
) {
  el.style.padding = "4px 5px";
  el.style.borderRadius = "10px";
  el.style.border = `1px solid ${TOKENS.border}`;
  el.style.cursor = "pointer";
  el.style.userSelect = "none";
  el.style.height = "34px";
  el.style.display = "inline-flex";
  el.style.alignItems = "center";
  el.style.justifyContent = "center";
  el.style.gap = "8px";

  // defaults
  el.style.background = "#101010";
  el.style.color = TOKENS.text;

  if (kind === "primary") {
    el.style.background = "#151515";
    el.style.border = `1px solid ${hexToRgba(TOKENS.info, 0.35)}`;
  } else if (kind === "danger") {
    el.style.background = hexToRgba(TOKENS.danger, 0.18);
    el.style.border = `1px solid ${hexToRgba(TOKENS.danger, 0.55)}`;
  } else if (kind === "ok") {
    el.style.background = hexToRgba(TOKENS.ok, 0.16);
    el.style.border = `1px solid ${hexToRgba(TOKENS.ok, 0.55)}`;
  } else if (kind === "warn") {
    el.style.background = hexToRgba(TOKENS.warn, 0.14);
    el.style.border = `1px solid ${hexToRgba(TOKENS.warn, 0.55)}`;
  } else {
    // ghost
    el.style.background = "#101010";
  }

  // subtle hover/focus (works without CSS file)
  el.onmouseenter = () => {
    el.style.filter = "brightness(1.08)";
  };
  el.onmouseleave = () => {
    el.style.filter = "none";
  };
}

export function styleSmallPill(el: HTMLElement, tone: Tone = "neutral") {
  const c = toneColor(tone);

  el.style.fontSize = "11px";
  el.style.padding = "2px 4px";
  el.style.borderRadius = "12px";
  el.style.border = `1px solid ${hexToRgba(
    c,
    tone === "neutral" ? 0.6 : 0.75
  )}`;
  el.style.background =
    tone === "neutral" ? TOKENS.inputBg : hexToRgba(c, 0.12);
  el.style.color = tone === "neutral" ? TOKENS.textMuted : TOKENS.text;
  el.style.whiteSpace = "nowrap";
}

/**
 * Use for OK/TODO chips in the left list.
 * Example: styleBadge(badge, ok ? "ok" : "todo")
 */
export function styleBadge(el: HTMLElement, tone: Tone) {
  styleSmallPill(el, tone);
  el.style.fontWeight = "600";
  el.style.letterSpacing = "0.04em";
  el.style.textTransform = "uppercase";
}

export function styleRowSelectable(
  el: HTMLElement,
  opts: { selected: boolean; tone?: Tone }
) {
  const tone = opts.tone ?? "info";
  el.style.borderRadius = "12px";
  el.style.border = `1px solid ${TOKENS.panelBorder}`;
  el.style.background = opts.selected
    ? hexToRgba(toneColor(tone), 0.12)
    : "transparent";

  if (opts.selected) {
    el.style.boxShadow = `0 0 0 1px ${hexToRgba(toneColor(tone), 0.25)} inset`;
  } else {
    el.style.boxShadow = "none";
  }
}

export function makeSectionTitle(text: string) {
  const el = document.createElement("div");
  el.textContent = text;
  el.style.fontWeight = "700";
  el.style.fontSize = "12px";
  el.style.opacity = "0.9";
  el.style.letterSpacing = "0.08em";
  el.style.textTransform = "uppercase";
  return el;
}

export function makeMuted(text: string) {
  const el = document.createElement("div");
  el.textContent = text;
  el.style.fontSize = "12px";
  el.style.color = TOKENS.textMuted;
  return el;
}

export function baseName(file: string) {
  return file.split("/").pop() ?? file;
}

export function safeText(s: unknown) {
  return typeof s === "string" ? s : String(s ?? "");
}

export function makeToast() {
  const toast = document.createElement("div");
  toast.style.position = "fixed";
  toast.style.right = "12px";
  toast.style.bottom = "12px";
  toast.style.padding = "10px 12px";
  toast.style.border = `1px solid ${TOKENS.border}`;
  toast.style.borderRadius = "12px";
  toast.style.background = TOKENS.panelBg;
  toast.style.color = TOKENS.text;
  toast.style.display = "none";
  toast.style.zIndex = "999999";
  toast.style.boxShadow = TOKENS.shadow;

  document.body.appendChild(toast);

  const show = (msg: string, tone: Tone = "neutral") => {
    toast.textContent = msg;
    toast.style.display = "block";
    toast.style.border = `1px solid ${hexToRgba(toneColor(tone), 0.6)}`;
    toast.style.background =
      tone === "neutral" ? TOKENS.panelBg : hexToRgba(toneColor(tone), 0.14);

    window.setTimeout(() => (toast.style.display = "none"), 1400);
  };

  return { show };
}
