import type { ChatMcp } from "../shared/contracts";
import type { Activity } from "./store";

/** How long a finished reconnect or check keeps its pill, so the result can be read. */
export const RESULT_SHOWN_MS = 2 * 60_000;

type Server = ChatMcp["servers"][number];

export const problems = (chat: ChatMcp | null, ignored: ReadonlySet<string>): Server[] =>
  (chat?.servers ?? []).filter(
    (server) =>
      (server.state === "failed" || server.state === "needs-auth") && !ignored.has(server.name),
  );

const recent = (activity: Activity | null) =>
  activity &&
  (activity.kind === "reconnecting" ||
    activity.kind === "checking" ||
    Date.now() - activity.at < RESULT_SHOWN_MS);

export interface PillText {
  /** Short: composer pills cut off after about a dozen characters. */
  label: string;
  /** The tooltip, in full. */
  title: string;
  icon: string;
}

/** What the pill says, or null when the chat has nothing worth a pill. */
export function pillText(
  chat: ChatMcp | null,
  activity: Activity | null,
  ignored: ReadonlySet<string>,
): PillText | null {
  if (activity?.kind === "reconnecting")
    return {
      label: "MCP …",
      title: "Restarting this chat so its MCP servers reconnect",
      icon: "RefreshCw",
    };
  if (activity?.kind === "checking")
    return { label: "MCP …", title: "Checking this chat's MCP servers", icon: "RefreshCw" };
  const found = problems(chat, ignored);
  if (found.length) {
    const needsAuth = found.filter((server) => server.state === "needs-auth").length;
    const failed = found.length - needsAuth;
    const parts = [
      needsAuth ? `${needsAuth} need${needsAuth === 1 ? "s" : ""} sign-in` : null,
      failed ? `${failed} failed` : null,
    ];
    return {
      label: `MCP · ${found.length}`,
      title: `MCP servers: ${parts.filter(Boolean).join(", ")}`,
      icon: "Unplug",
    };
  }
  if (!recent(activity)) return null;
  if (activity?.kind === "error")
    return { label: "MCP ✗", title: `MCP: ${activity.message}`, icon: "Unplug" };
  if (activity?.kind === "done") {
    if (activity.reopened === false)
      return { label: "MCP ?", title: "The restart wasn't confirmed", icon: "Unplug" };
    return {
      label: "MCP ✓",
      title: activity.reopened ? "Reconnected: every MCP server is up" : "Every MCP server is up",
      icon: "PlugZap",
    };
  }
  return null;
}

export const ago = (iso: string | number) => {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`;
};
