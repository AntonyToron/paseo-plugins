import { describe, expect, it } from "vitest";
import { strokesFor } from "./shortcuts";

const stroke = (
  key: string,
  code: string,
  mods: Partial<Record<"meta" | "ctrl" | "alt" | "shift", boolean>> = {},
) => ({
  key,
  code,
  meta: false,
  ctrl: false,
  alt: false,
  shift: false,
  ...mods,
});

describe("strokesFor", () => {
  it("uses Paseo's default when there is no override", () => {
    expect(strokesFor("workspace-tab-navigate-relative-alt-shift-right", {})).toEqual([
      stroke("]", "BracketRight", { alt: true, shift: true }),
    ]);
  });

  it("follows a multi-step override", () => {
    const overrides = { "workspace-tab-navigate-relative-alt-shift-right": "Ctrl+A N" };
    expect(strokesFor("workspace-tab-navigate-relative-alt-shift-right", overrides)).toEqual([
      stroke("a", "KeyA", { ctrl: true }),
      stroke("n", "KeyN"),
    ]);
  });

  it("fills in the digit placeholder", () => {
    expect(strokesFor("workspace-tab-navigate-index-cmd-alt-digit-mac-desktop", {}, 3)).toEqual([
      stroke("3", "Digit3", { meta: true, alt: true }),
    ]);
  });

  it("returns null for an unassigned binding", () => {
    expect(
      strokesFor("workspace-pane-close-cmd-shift-w", { "workspace-pane-close-cmd-shift-w": null }),
    ).toBeNull();
  });

  it("parses named keys", () => {
    expect(strokesFor("workspace-pane-focus-left-cmd-shift-left", {})).toEqual([
      stroke("ArrowLeft", "ArrowLeft", { meta: true, shift: true }),
    ]);
  });
});
