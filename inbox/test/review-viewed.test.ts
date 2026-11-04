import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewFile } from "../shared/review";

const calls: string[][] = [];
let refuse = (_paths: readonly string[]) => false;
vi.mock("../server/review-github", () => ({
  markViewed: vi.fn(async (_id: string, paths: string[]) => {
    calls.push(paths);
    if (refuse(paths)) throw new Error("gh api graphql -f query=mutation {...}\ngh: HTTP 502");
  }),
}));
const { ViewedQueue } = await import("../server/review-viewed");

const file = (path: string): ReviewFile => ({
  path,
  additions: 1,
  deletions: 0,
  changeType: "MODIFIED",
  viewed: "UNVIEWED",
  group: "tests",
});
const settle = () => vi.runAllTimersAsync();

describe("ViewedQueue", () => {
  beforeEach(() => {
    calls.length = 0;
    refuse = () => false;
    vi.useFakeTimers();
  });

  it("sends one mark per request and shows them as done meanwhile and after", async () => {
    const queue = new ViewedQueue();
    const paths = ["a", "b", "c"];
    queue.enqueue("pr", "PR_1", paths, true);
    const before = queue.overlay("pr", paths.map(file));
    expect(before.marking).toBe(3);
    expect(before.files.every((entry) => entry.viewed === "VIEWED")).toBe(true);
    await settle();
    expect(calls).toEqual([["a"], ["b"], ["c"]]);
    // The list read before the marks still shows them, until a fresh read replaces it.
    const after = queue.overlay("pr", paths.map(file));
    expect(after).toMatchObject({ marking: 0, markError: null });
    expect(after.files.every((entry) => entry.viewed === "VIEWED")).toBe(true);
    queue.forgetSaved("pr");
    expect(queue.overlay("pr", paths.map(file)).files[0]?.viewed).toBe("UNVIEWED");
  });

  it("retries a refused mark once, then drops it with GitHub's answer", async () => {
    refuse = (batch) => batch.includes("b");
    const queue = new ViewedQueue();
    queue.enqueue("pr", "PR_1", ["a", "b", "c"], true);
    await settle();
    expect(calls).toEqual([["a"], ["b"], ["b"], ["c"]]);
    const after = queue.overlay("pr", ["a", "b", "c"].map(file));
    expect(after).toMatchObject({ marking: 0, markError: "gh: HTTP 502" });
    expect(after.files.map((entry) => entry.viewed)).toEqual(["VIEWED", "UNVIEWED", "VIEWED"]);
  });
});
