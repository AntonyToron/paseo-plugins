import {
  classify,
  GROUP_LABELS,
  GROUPS,
  type PullRequestSummary,
  type WorkspaceStatus,
} from "./model";

/** Dash's groups, plus one for what Dash leaves out, since the sidebar can't hide a workspace. */
export const SIDEBAR_GROUPS = [...GROUPS, "other"] as const;
export type SidebarGroup = (typeof SIDEBAR_GROUPS)[number];

export const SIDEBAR_GROUP_LABELS: Record<SidebarGroup, string> = {
  ...GROUP_LABELS,
  other: "Others' drafts",
};

/** Long, quiet groups start folded so what needs you stays near the top. */
export const FOLDED_BY_DEFAULT: ReadonlySet<SidebarGroup> = new Set(["done", "other"]);

/**
 * Where a workspace goes, from its live status and the PR summary Dash last fetched. Status
 * changes show at once; PR details follow Dash's polling.
 */
export function placeWorkspace(
  status: WorkspaceStatus,
  pullRequest: PullRequestSummary | null,
): { group: SidebarGroup; detail: string } {
  return (
    classify(status, pullRequest) ?? {
      group: "other",
      detail: pullRequest ? `#${pullRequest.number} · draft, not asking for review yet` : "",
    }
  );
}

/** A merged or closed PR with nothing that would go with the worktree: safe to archive. */
export const readyToArchive = (
  pullRequest: PullRequestSummary | null,
  archiveRisks: readonly string[],
) => Boolean(pullRequest && pullRequest.state !== "OPEN" && archiveRisks.length === 0);
