import { describe, expect, it } from "vitest";
import {
  EMPTY_PENDING,
  feed,
  type FeedResult,
  globalCommand,
  type Pending,
  paseoCombo,
  toToken,
} from "./keymap";

function feedAll(tokens: string[]): FeedResult {
  let pending: Pending = EMPTY_PENDING;
  let result: FeedResult = { type: "unmapped", aborted: false };
  for (const token of tokens) {
    result = feed(pending, token);
    if (result.type === "pending") pending = result.pending;
  }
  return result;
}

const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...mods,
});

describe("feed", () => {
  it("runs single-key bindings", () => {
    expect(feedAll(["j"])).toEqual({
      type: "run",
      command: { kind: "scroll", unit: "line", sign: 1, times: 1 },
    });
  });

  it("applies a count", () => {
    expect(feedAll(["1", "2", "k"])).toEqual({
      type: "run",
      command: { kind: "scroll", unit: "line", sign: -1, times: 12 },
    });
  });

  it("waits on a prefix, then runs the sequence", () => {
    expect(feedAll(["g"])).toEqual({ type: "pending", pending: { count: "", keys: ["g"] } });
    expect(feedAll(["g", "g"])).toEqual({ type: "run", command: { kind: "scroll-to", edge: "top" } });
  });

  it("treats a count before gt as a tab index, like vim", () => {
    expect(feedAll(["3", "g", "t"])).toEqual({ type: "run", command: { kind: "tab-index", index: 3 } });
    expect(feedAll(["g", "t"])).toEqual({ type: "run", command: { kind: "tab", sign: 1, times: 1 } });
  });

  it("supports both <C-w> h and <C-w> <C-h>", () => {
    const left = { type: "run", command: { kind: "pane-focus", direction: "left" } };
    expect(feedAll(["<C-w>", "h"])).toEqual(left);
    expect(feedAll(["<C-w>", "<C-h>"])).toEqual(left);
  });

  it("does not start a count with 0", () => {
    expect(feedAll(["0"])).toEqual({ type: "unmapped", aborted: false });
  });

  it("reports aborted sequences so the key is swallowed", () => {
    expect(feedAll(["g", "x"])).toEqual({ type: "unmapped", aborted: true });
    expect(feedAll(["x"])).toEqual({ type: "unmapped", aborted: false });
  });
});

describe("global bindings", () => {
  it("maps Ctrl-j and Ctrl-k to workspace movement", () => {
    expect(globalCommand("<C-j>")).toEqual({ kind: "workspace", sign: 1 });
    expect(globalCommand("<C-k>")).toEqual({ kind: "workspace", sign: -1 });
    expect(globalCommand("j")).toBeNull();
  });

  it("spells ctrl tokens the way Paseo stores overrides", () => {
    expect(paseoCombo("<C-j>")).toBe("Ctrl+J");
    expect(paseoCombo("j")).toBeNull();
  });
});

describe("toToken", () => {
  it("keeps shifted letters distinct", () => {
    expect(toToken(key("G"))).toBe("G");
    expect(toToken(key("g"))).toBe("g");
  });

  it("formats ctrl chords and maps <C-[> to Esc", () => {
    expect(toToken(key("d", { ctrlKey: true }))).toBe("<C-d>");
    expect(toToken(key("D", { ctrlKey: true }))).toBe("<C-d>");
    expect(toToken(key("[", { ctrlKey: true }))).toBe("<Esc>");
    expect(toToken(key("Escape"))).toBe("<Esc>");
  });

  it("leaves Cmd and Alt shortcuts and bare modifiers to Paseo", () => {
    expect(toToken(key("k", { metaKey: true }))).toBeNull();
    expect(toToken(key("]", { altKey: true }))).toBeNull();
    expect(toToken(key("Shift"))).toBeNull();
    expect(toToken(key("Tab"))).toBeNull();
  });
});
