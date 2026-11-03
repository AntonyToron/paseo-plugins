export type Direction = "left" | "down" | "up" | "right";

export type Command =
  | { kind: "scroll"; unit: "line" | "half-page" | "page"; sign: 1 | -1; times: number }
  | { kind: "scroll-to"; edge: "top" | "bottom" }
  | { kind: "tab"; sign: 1 | -1; times: number }
  | { kind: "tab-index"; index: number }
  | { kind: "workspace"; sign: 1 | -1 }
  | { kind: "pane-focus"; direction: Direction }
  | { kind: "pane-split"; direction: "right" | "down" }
  | { kind: "pane-close" }
  | { kind: "pane-zoom" }
  | { kind: "insert" }
  | { kind: "command-center" }
  | { kind: "files" }
  | { kind: "find" };

type Binding = (count: number | null) => Command;

const scroll =
  (unit: "line" | "half-page" | "page", sign: 1 | -1): Binding =>
  (count) => ({ kind: "scroll", unit, sign, times: count ?? 1 });

const paneFocus =
  (direction: Direction): Binding =>
  () => ({ kind: "pane-focus", direction });

const insert: Binding = () => ({ kind: "insert" });
const paneClose: Binding = () => ({ kind: "pane-close" });

// Keys are space-separated tokens so `<C-w> h` can never collide with a literal sequence.
const BINDINGS: Record<string, Binding> = {
  j: scroll("line", 1),
  k: scroll("line", -1),
  "<C-e>": scroll("line", 1),
  "<C-y>": scroll("line", -1),
  "<C-d>": scroll("half-page", 1),
  "<C-u>": scroll("half-page", -1),
  "<C-f>": scroll("page", 1),
  "<C-b>": scroll("page", -1),
  "g g": () => ({ kind: "scroll-to", edge: "top" }),
  G: () => ({ kind: "scroll-to", edge: "bottom" }),

  "g t": (count) =>
    count === null ? { kind: "tab", sign: 1, times: 1 } : { kind: "tab-index", index: count },
  "g T": (count) => ({ kind: "tab", sign: -1, times: count ?? 1 }),
  "] w": () => ({ kind: "workspace", sign: 1 }),
  "[ w": () => ({ kind: "workspace", sign: -1 }),

  "<C-w> h": paneFocus("left"),
  "<C-w> j": paneFocus("down"),
  "<C-w> k": paneFocus("up"),
  "<C-w> l": paneFocus("right"),
  "<C-w> <C-h>": paneFocus("left"),
  "<C-w> <C-j>": paneFocus("down"),
  "<C-w> <C-k>": paneFocus("up"),
  "<C-w> <C-l>": paneFocus("right"),
  "<C-w> v": () => ({ kind: "pane-split", direction: "right" }),
  "<C-w> s": () => ({ kind: "pane-split", direction: "down" }),
  "<C-w> q": paneClose,
  "<C-w> c": paneClose,
  "<C-w> o": () => ({ kind: "pane-zoom" }),

  i: insert,
  a: insert,
  I: insert,
  A: insert,
  ":": () => ({ kind: "command-center" }),
  "<C-p>": () => ({ kind: "files" }),
  "/": () => ({ kind: "find" }),
};

const SEQUENCES = Object.keys(BINDINGS);

// Work in every mode, like a tmux binding without a prefix.
const GLOBAL_BINDINGS: Record<string, Command> = {
  "<C-j>": { kind: "workspace", sign: 1 },
  "<C-k>": { kind: "workspace", sign: -1 },
};

export function globalCommand(token: string): Command | null {
  return GLOBAL_BINDINGS[token] ?? null;
}

/** Paseo's spelling of a ctrl token, e.g. `<C-j>` -> `Ctrl+J`. */
export function paseoCombo(token: string): string | null {
  const match = /^<C-(.)>$/.exec(token);
  return match ? `Ctrl+${match[1].toUpperCase()}` : null;
}

export interface Pending {
  count: string;
  keys: string[];
}

export const EMPTY_PENDING: Pending = { count: "", keys: [] };

export type FeedResult =
  | { type: "run"; command: Command }
  | { type: "pending"; pending: Pending }
  /** `aborted` is true when the key broke a sequence in progress, which vim swallows. */
  | { type: "unmapped"; aborted: boolean };

export function feed(pending: Pending, token: string): FeedResult {
  const startsCount = token !== "0" || pending.count !== "";
  if (pending.keys.length === 0 && /^[0-9]$/.test(token) && startsCount) {
    return { type: "pending", pending: { count: pending.count + token, keys: [] } };
  }

  const keys = [...pending.keys, token];
  const sequence = keys.join(" ");
  const binding = BINDINGS[sequence];
  if (binding) {
    const count = pending.count === "" ? null : Number(pending.count);
    return { type: "run", command: binding(count) };
  }
  if (SEQUENCES.some((candidate) => candidate.startsWith(`${sequence} `))) {
    return { type: "pending", pending: { count: pending.count, keys } };
  }
  return { type: "unmapped", aborted: pending.count !== "" || pending.keys.length > 0 };
}

export function describePending(pending: Pending): string {
  return pending.count + pending.keys.join("");
}

export interface KeyInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

const NAMED_KEYS: Record<string, string> = {
  Escape: "<Esc>",
  Enter: "<CR>",
  " ": "<Space>",
};

/** Vim-style token for a keypress, or null for keys the plugin never handles. */
export function toToken(input: KeyInput): string | null {
  if (input.metaKey || input.altKey) {
    return null;
  }
  const named = NAMED_KEYS[input.key];
  if (named) {
    return named;
  }
  if (input.key.length !== 1) {
    return null;
  }
  if (input.ctrlKey) {
    return input.key === "[" ? "<Esc>" : `<C-${input.key.toLowerCase()}>`;
  }
  return input.key;
}
