import { z } from "zod";

export const GROUPS = ["needs-you", "relook", "working", "unread", "waiting", "done"] as const;
export type Group = (typeof GROUPS)[number];

export const GROUP_LABELS: Record<Group, string> = {
  "needs-you": "Needs you",
  relook: "Re-look",
  working: "Working",
  unread: "Unread",
  waiting: "Waiting",
  done: "Done",
};

export const pullRequestSummary = z.object({
  number: z.number(),
  url: z.string(),
  state: z.enum(["OPEN", "MERGED", "CLOSED"]),
  isDraft: z.boolean(),
  mine: z.boolean(),
  checks: z.enum(["passed", "failed", "pending", "none"]),
  reviewDecision: z.enum(["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"]).nullable(),
  newCommits: z.number(),
  newComments: z.number(),
});
export type PullRequestSummary = z.infer<typeof pullRequestSummary>;

export const dashRow = z.object({
  workspaceId: z.string(),
  /** The chat a press opens, and the one Re-review talks to. */
  agentId: z.string().nullable(),
  title: z.string(),
  activityAt: z.string().nullable(),
  group: z.enum(GROUPS),
  detail: z.string(),
  pullRequest: pullRequestSummary.nullable(),
  pullRequestError: z.string().nullable(),
  /** Work that only exists in this workspace's worktree and would go with it. */
  archiveRisks: z.array(z.string()),
});
export type DashRow = z.infer<typeof dashRow>;

export type WorkspaceStatus = "needs_input" | "failed" | "running" | "attention" | "done";

const plural = (count: number, noun: string) => `${count} new ${noun}${count === 1 ? "" : "s"}`;

export function changesSinceLook(pullRequest: PullRequestSummary): string | null {
  const parts = [
    pullRequest.newCommits && plural(pullRequest.newCommits, "commit"),
    pullRequest.newComments && plural(pullRequest.newComments, "comment"),
  ].filter(Boolean);
  return parts.length ? `${parts.join(", ")} since you looked` : null;
}

function openPullRequestState(pullRequest: PullRequestSummary): string {
  if (!pullRequest.mine) return "waiting on author";
  if (pullRequest.checks === "failed") return "checks failing";
  if (pullRequest.reviewDecision === "CHANGES_REQUESTED") return "changes requested";
  if (pullRequest.reviewDecision === "APPROVED") return "approved";
  if (pullRequest.checks === "pending") return "checks running";
  return pullRequest.isDraft ? "draft" : "waiting on review";
}

/**
 * Sorts a workspace into one group and says, in one line, why it is there. Null hides it: someone
 * else's draft isn't asking for review yet, so it stays out until it's marked ready, unless the
 * chat itself needs you, is working, or has an answer you haven't seen.
 */
export function classify(
  status: WorkspaceStatus,
  pullRequest: PullRequestSummary | null,
): { group: Group; detail: string } | null {
  const prefix = pullRequest ? `#${pullRequest.number} · ` : "";
  if (status === "needs_input") return { group: "needs-you", detail: `${prefix}waiting for you` };
  if (status === "failed") return { group: "needs-you", detail: `${prefix}stopped with an error` };
  if (status === "running") return { group: "working", detail: `${prefix}working` };
  if (pullRequest?.state === "MERGED") return { group: "done", detail: `${prefix}merged` };
  if (pullRequest?.state === "CLOSED") return { group: "done", detail: `${prefix}closed` };
  const othersDraft = Boolean(pullRequest && pullRequest.isDraft && !pullRequest.mine);
  const changes = pullRequest && !othersDraft ? changesSinceLook(pullRequest) : null;
  if (changes) return { group: "relook", detail: prefix + changes };
  if (status === "attention") return { group: "unread", detail: `${prefix}finished` };
  if (othersDraft) return null;
  if (pullRequest) return { group: "waiting", detail: prefix + openPullRequestState(pullRequest) };
  return { group: "done", detail: "finished" };
}
