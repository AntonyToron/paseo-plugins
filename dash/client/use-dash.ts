import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { getDashSnapshot } from "../shared/contracts";
import { GROUPS, type DashRow, type Group } from "../shared/model";

export const dashKeys = { snapshot: ["paseo-dash", "snapshot"] as const };
const REFRESH_MS = 5_000;

export function useDashSnapshot() {
  const snapshot = useRpc(getDashSnapshot);
  return useQuery({
    queryKey: dashKeys.snapshot,
    queryFn: () => snapshot({}),
    refetchInterval: REFRESH_MS,
    select: (result) => groupRows(result.rows),
  });
}

export interface DashGroupRows {
  group: Group;
  rows: DashRow[];
}

function groupRows(rows: readonly DashRow[]): DashGroupRows[] {
  const newestFirst = [...rows].sort((a, b) => (b.activityAt ?? "").localeCompare(a.activityAt ?? ""));
  return GROUPS.map((group) => ({ group, rows: newestFirst.filter((row) => row.group === group) })).filter(
    (entry) => entry.rows.length > 0,
  );
}

/** The rows worth a glance from the sidebar: something needs you, or a PR moved since you looked. */
export const attentionCount = (groups: readonly DashGroupRows[]) =>
  groups.filter(({ group }) => group === "needs-you" || group === "relook").reduce((sum, { rows }) => sum + rows.length, 0);

export function relativeTime(iso: string | null, now = Date.now()): string {
  if (!iso) return "";
  const minutes = Math.round((now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function reReviewPrompt(row: DashRow): string {
  const pr = row.pullRequest;
  const what = pr
    ? [pr.newCommits && `${pr.newCommits} new commit${pr.newCommits === 1 ? "" : "s"}`, pr.newComments && `${pr.newComments} new comment${pr.newComments === 1 ? "" : "s"}`]
        .filter(Boolean)
        .join(" and ")
    : "new activity";
  return `PR #${pr?.number ?? ""} has ${what} since you last looked. Review just what changed since then, and tell me whether your earlier points were addressed.`;
}
