import { describe, expect, it } from "vitest";
import {
  myAction,
  myStatus,
  needsTriage,
  sortReviewRequests,
  urgency,
  type MyPullRequest,
  type ReviewRequest,
} from "../shared/model";

const NOW = Date.parse("2026-11-03T12:00:00Z");
const daysAgo = (days: number) => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();

const request = (overrides: Partial<ReviewRequest> = {}): ReviewRequest => ({
  repo: "acme/app",
  number: 1,
  title: "[feat] add a settings page",
  url: "https://github.com/acme/app/pull/1",
  author: "sam",
  branch: "sam/settings",
  labels: ["Medium Priority"],
  requestedAt: daysAgo(1),
  updatedAt: daysAgo(1),
  body: "",
  approvedBy: [],
  changesRequestedBy: [],
  ...overrides,
});

describe("urgency", () => {
  it("puts High Priority first, then security, then Medium Priority that has waited", () => {
    expect(urgency(request({ labels: ["High Priority"] }), NOW)?.rank).toBe(3);
    expect(
      urgency(request({ title: "[fix] require an authenticator code for the admin panel" }), NOW)
        ?.rank,
    ).toBe(2);
    expect(urgency(request({ requestedAt: daysAgo(9) }), NOW)).toEqual({
      reason: "Medium priority · waiting 9 days",
      rank: 1,
    });
    expect(urgency(request(), NOW)).toBeNull();
  });

  it("leaves security-looking PRs marked Low Priority where they are", () => {
    expect(
      urgency(request({ title: "[fix] PKCE for the OAuth flow", labels: ["Low Priority"] }), NOW),
    ).toBeNull();
  });

  it("doesn't raise a waiting PR someone else has approved, or one past the stale cutoff", () => {
    expect(urgency(request({ requestedAt: daysAgo(9), approvedBy: ["kim"] }), NOW)).toBeNull();
    expect(urgency(request({ requestedAt: daysAgo(45) }), NOW)).toBeNull();
  });
});

describe("sortReviewRequests", () => {
  it("folds old requests into stale unless they're urgent, and says who already reviewed", () => {
    const sorted = sortReviewRequests(
      [
        request({ number: 1, requestedAt: daysAgo(60) }),
        request({ number: 2, requestedAt: daysAgo(60), labels: ["High Priority"] }),
        request({ number: 3, approvedBy: ["kim"] }),
      ],
      NOW,
    );
    expect(sorted.stale.map((item) => item.number)).toEqual([1]);
    expect(sorted.priority.map((item) => item.number)).toEqual([2]);
    expect(sorted.reviews[0]?.reason).toBe("medium priority · approved by kim");
  });

  it("lets Claude's check raise a request to the top, or note that it isn't needed, but never hide it", () => {
    const triage = new Map([
      [
        "acme/app#4",
        {
          verdict: "review_now" as const,
          reason: "Kim asked for a review in #eng",
          slackUrl: "https://acme.slack.com/archives/C1/p1",
        },
      ],
      [
        "acme/app#5",
        { verdict: "not_needed" as const, reason: "Sam is reviewing it", slackUrl: null },
      ],
    ]);
    const sorted = sortReviewRequests(
      [request({ number: 4 }), request({ number: 5 })],
      NOW,
      triage,
    );
    expect(sorted.priority).toMatchObject([
      {
        number: 4,
        reason: "Claude: Kim asked for a review in #eng",
        slackUrl: "https://acme.slack.com/archives/C1/p1",
      },
    ]);
    expect(sorted.reviews).toMatchObject([
      { number: 5, reason: "medium priority · Claude: Sam is reviewing it" },
    ]);
  });
});

describe("needsTriage", () => {
  it("checks requests that have waited a couple of days and aren't already at the top", () => {
    expect(needsTriage(request({ requestedAt: daysAgo(3), labels: ["Low Priority"] }), NOW)).toBe(
      true,
    );
    expect(needsTriage(request({ requestedAt: daysAgo(1) }), NOW)).toBe(false);
    expect(needsTriage(request({ requestedAt: daysAgo(3), labels: ["High Priority"] }), NOW)).toBe(
      false,
    );
  });
});

describe("myAction", () => {
  const pr = (overrides: Partial<MyPullRequest> = {}): MyPullRequest => ({
    repo: "acme/app",
    number: 9,
    title: "[fix] something",
    url: "https://github.com/acme/app/pull/9",
    isDraft: false,
    reviewDecision: null,
    updatedAt: daysAgo(1),
    checks: "SUCCESS",
    lastCommitAt: daysAgo(3),
    feedback: [],
    ...overrides,
  });

  it("sums up where each of your PRs stands", () => {
    expect(myStatus(pr({ isDraft: true }), "me")).toBe("draft");
    expect(myStatus(pr({ checks: "PENDING" }), "me")).toBe("checks running · waiting on review");
    expect(myStatus(pr({ reviewDecision: "CHANGES_REQUESTED", checks: "PENDING" }), "me")).toBe(
      "checks running · changes requested",
    );
    expect(myStatus(pr({ reviewDecision: "APPROVED" }), "me")).toBe("approved, ready to merge");
  });
  const from = (login: string, days: number, isBot = false) => ({
    login,
    at: daysAgo(days),
    isBot,
  });

  it("flags feedback left after your last push or reply", () => {
    expect(
      myAction(pr({ feedback: [from("kim", 1)], reviewDecision: "CHANGES_REQUESTED" }), "me")
        ?.reason,
    ).toBe("kim requested changes since your last push or reply");
  });

  it("treats a later push or reply as answering it, and ignores bots", () => {
    expect(myAction(pr({ feedback: [from("kim", 4)] }), "me")).toBeNull();
    expect(myAction(pr({ feedback: [from("kim", 2), from("me", 1)] }), "me")).toBeNull();
    expect(
      myAction(pr({ feedback: [from("coderabbitai", 1), from("linear", 1, true)] }), "me"),
    ).toBeNull();
  });

  it("asks you to fix failing checks or merge an approved PR, but not on drafts", () => {
    expect(myAction(pr({ checks: "FAILURE" }), "me")?.reason).toBe("checks failing");
    expect(myAction(pr({ reviewDecision: "APPROVED" }), "me")?.reason).toBe(
      "approved, ready to merge",
    );
    expect(myAction(pr({ isDraft: true, checks: "FAILURE" }), "me")).toBeNull();
  });
});
