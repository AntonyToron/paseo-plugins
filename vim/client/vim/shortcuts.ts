// Paseo's macOS desktop defaults, keyed by the binding IDs its override store uses.
const DEFAULTS = {
  "workspace-tab-navigate-relative-alt-shift-right": "Alt+Shift+]",
  "workspace-tab-navigate-relative-alt-shift-left": "Alt+Shift+[",
  "workspace-tab-navigate-index-cmd-alt-digit-mac-desktop": "Cmd+Alt+Digit",
  "workspace-navigate-relative-cmd-right-mac": "Cmd+]",
  "workspace-navigate-relative-cmd-left-mac": "Cmd+[",
  "workspace-pane-focus-left-cmd-shift-left": "Cmd+Shift+ArrowLeft",
  "workspace-pane-focus-right-cmd-shift-right": "Cmd+Shift+ArrowRight",
  "workspace-pane-focus-up-cmd-shift-up": "Cmd+Shift+ArrowUp",
  "workspace-pane-focus-down-cmd-shift-down": "Cmd+Shift+ArrowDown",
  "workspace-pane-split-right-cmd-backslash": "Cmd+\\",
  "workspace-pane-split-down-cmd-shift-backslash": "Cmd+Shift+\\",
  "workspace-pane-close-cmd-shift-w": "Cmd+Shift+W",
  "message-input-focus-cmd-l-mac": "Cmd+L",
  "command-center-toggle-cmd-k-mac": "Cmd+K",
  "workspace-project-pick-cmd-p-mac": "Cmd+P",
  "sidebar-toggle-right-cmd-e-mac": "Cmd+E",
} as const;

export type BindingId = keyof typeof DEFAULTS;

/** Paseo's stored overrides: a combo string, or null for a shortcut the user unassigned. */
export type Overrides = Record<string, unknown>;

export interface KeyStroke {
  key: string;
  code: string;
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

const PUNCTUATION_CODES: Record<string, string> = {
  "-": "Minus",
  "=": "Equal",
  "\\": "Backslash",
  "[": "BracketLeft",
  "]": "BracketRight",
  ";": "Semicolon",
  "'": "Quote",
  ",": "Comma",
  ".": "Period",
  "`": "Backquote",
  "/": "Slash",
  "?": "Slash",
};

const NAMED_KEYS: Record<string, { key: string; code: string }> = {
  Space: { key: " ", code: "Space" },
  Enter: { key: "Enter", code: "Enter" },
  Backspace: { key: "Backspace", code: "Backspace" },
};

function keyFor(name: string, digit: number | undefined): { key: string; code: string } | null {
  if (name === "Digit") {
    return digit === undefined ? null : { key: String(digit), code: `Digit${digit}` };
  }
  if (/^[A-Z]$/.test(name)) return { key: name.toLowerCase(), code: `Key${name}` };
  if (/^[0-9]$/.test(name)) return { key: name, code: `Digit${name}` };
  const punctuation = PUNCTUATION_CODES[name];
  if (punctuation) return { key: name, code: punctuation };
  // Escape, arrows, Tab, Home, End, PageUp/Down, F1-F12: key and code share the name.
  return NAMED_KEYS[name] ?? { key: name, code: name };
}

function parseStroke(step: string, digit: number | undefined): KeyStroke | null {
  const stroke: KeyStroke = { key: "", code: "", meta: false, ctrl: false, alt: false, shift: false };
  for (const part of step.split("+")) {
    if (part === "Cmd" || part === "Mod") stroke.meta = true;
    else if (part === "Ctrl") stroke.ctrl = true;
    else if (part === "Alt") stroke.alt = true;
    else if (part === "Shift") stroke.shift = true;
    else {
      const key = keyFor(part, digit);
      if (!key || stroke.code !== "") return null;
      stroke.key = key.key;
      stroke.code = key.code;
    }
  }
  return stroke.code === "" ? null : stroke;
}

/**
 * The keystrokes that currently trigger a Paseo binding, honoring the user's overrides,
 * including multi-step chords like `Ctrl+A N`. Null when the binding is unassigned.
 */
export function strokesFor(id: BindingId, overrides: Overrides, digit?: number): KeyStroke[] | null {
  const override = overrides[id];
  if (override === null) return null;
  const combo = typeof override === "string" ? override : DEFAULTS[id];
  const strokes = combo.split(" ").map((step) => parseStroke(step, digit));
  return strokes.every((stroke) => stroke !== null) ? (strokes as KeyStroke[]) : null;
}
