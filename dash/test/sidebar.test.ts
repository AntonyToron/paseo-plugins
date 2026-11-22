import { describe, expect, it } from "vitest";
import type { PullRequestSummary } from "../shared/model";
import { placeWorkspace, readyToArchive } from "../shared/sidebar";

const pr = (overrides: Partial<PullRequestSummary> = {}): PullRequestSummary => ({
  number: 8007,
  url: "https://github.com/acme/app/pull/8007",
  state: "OPEN",
  isDraft: false,
  mine: false,
  checks: "passed",
  reviewDecision: null,
  newCommits: 0,
  newComments: 0,
  ...overrides,
});

describe("placeWorkspace", () => {
  it("follows Dash's groups", () => {
    expect(placeWorkspace("needs_input", pr())).toEqual({
      group: "needs-you",
      detail: "#8007 · waiting for you",
    });
    expect(placeWorkspace("done", pr({ state: "MERGED" })).group).toBe("done");
  });

  it("keeps a workspace Dash would hide, so the sidebar never loses one", () => {
    expect(placeWorkspace("done", pr({ isDraft: true }))).toEqual({
      group: "other",
      detail: "#8007 · draft, not asking for review yet",
    });
  });
});

describe("readyToArchive", () => {
  it("offers archiving for a merged or closed PR with nothing to lose", () => {
    expect(readyToArchive(pr({ state: "MERGED" }), [])).toBe(true);
    expect(readyToArchive(pr({ state: "CLOSED" }), [])).toBe(true);
  });

  it("holds back an open PR, no PR, or work that only lives in the worktree", () => {
    expect(readyToArchive(pr(), [])).toBe(false);
    expect(readyToArchive(null, [])).toBe(false);
    expect(readyToArchive(pr({ state: "MERGED" }), ["2 unpushed commits"])).toBe(false);
  });
});
