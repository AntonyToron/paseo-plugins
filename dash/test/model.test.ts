import { describe, expect, it } from "vitest";
import { classify, type PullRequestSummary } from "../shared/model";

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

describe("classify", () => {
  it("puts a reviewed PR with new commits in Re-look", () => {
    expect(classify("done", pr({ newCommits: 3, newComments: 1 }))).toEqual({
      group: "relook",
      detail: "#8007 · 3 new commits, 1 new comment since you looked",
    });
  });

  it("waits on the author when nothing changed", () => {
    expect(classify("done", pr())).toEqual({ group: "waiting", detail: "#8007 · waiting on author" });
  });

  it("shows your own PR's blocker instead", () => {
    expect(classify("done", pr({ mine: true, checks: "failed" })).detail).toBe("#8007 · checks failing");
  });

  it("marks merged and closed PRs done, even with activity after the last look", () => {
    expect(classify("done", pr({ state: "MERGED", newCommits: 2 }))).toEqual({ group: "done", detail: "#8007 · merged" });
  });

  it("lets live chat state win over PR state", () => {
    expect(classify("running", pr({ newCommits: 2 })).group).toBe("working");
    expect(classify("needs_input", pr()).group).toBe("needs-you");
  });

  it("files a finished chat without a PR under Unread until seen, then Done", () => {
    expect(classify("attention", null)).toEqual({ group: "unread", detail: "finished" });
    expect(classify("done", null)).toEqual({ group: "done", detail: "finished" });
  });
});
