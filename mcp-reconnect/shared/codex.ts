import type { McpServerStatus } from "./mcp";

/** One server from `codex mcp list --json`. */
export interface CodexConfiguredServer {
  name: string;
  enabled: boolean;
  auth_status?: string | null;
  startup_timeout_sec?: number | null;
}

/**
 * What a Codex chat's session log says about its MCP servers. Codex records the tools a chat can
 * use in `world_state` entries: one full list when the thread starts, then only what was added.
 * It never records a server going away, and nothing at all for a server that failed to start.
 */
export interface CodexLog {
  startedAt: string | null;
  /** The last time Codex was working on a turn, when it would have recorded a server that came up. */
  activeAt: string | null;
  tools: Set<string>;
}

export const emptyCodexLog = (): CodexLog => ({
  startedAt: null,
  activeAt: null,
  tools: new Set(),
});

interface CodexLogLine {
  timestamp?: string;
  type?: string;
  payload?: {
    type?: string;
    timestamp?: string;
    full?: boolean;
    state?: { tools?: Record<string, unknown> };
  };
}

export function readCodexLine(log: CodexLog, line: string): void {
  // Most lines are model output; only these three kinds matter, so skip parsing the rest.
  if (
    !line.includes('"world_state"') &&
    !line.includes('"session_meta"') &&
    !line.includes('"task_started"')
  )
    return;
  let record: CodexLogLine;
  try {
    record = JSON.parse(line) as CodexLogLine;
  } catch {
    return;
  }
  const at = record.timestamp;
  if (!at) return;
  if (record.type === "session_meta") {
    log.startedAt ??= record.payload?.timestamp ?? at;
    return;
  }
  if (record.type === "world_state") {
    const tools = record.payload?.state?.tools;
    if (tools) {
      if (record.payload?.full) log.tools.clear();
      for (const name of Object.keys(tools)) if (name.startsWith("mcp__")) log.tools.add(name);
    }
    log.activeAt = at;
    return;
  }
  if (record.payload?.type === "task_started") log.activeAt = at;
}

/** Codex names a server's tools after it with anything but letters, digits and `_` turned into `_`. */
const toolPrefix = (name: string) => `mcp__${name.replace(/[^A-Za-z0-9_]/g, "_")}`;
const APP_PREFIX = "mcp__codex_apps__";
// Codex's default, used when a server doesn't set its own.
const DEFAULT_STARTUP_SEC = 10;
const STARTUP_SLACK_MS = 5_000;

/**
 * Each configured server's state in this chat. A server that isn't signed in needs a sign-in. One
 * that never showed up while Codex worked on a turn well after the chat opened failed to start.
 * Before that, it may still be starting; Codex only notes it at the next turn.
 */
export function codexServers(
  log: CodexLog,
  configured: readonly CodexConfiguredServer[],
  openedAt: number | null,
): McpServerStatus[] {
  const startedAt = Math.max(openedAt ?? 0, log.startedAt ? Date.parse(log.startedAt) : 0);
  const activeAt = log.activeAt ? Date.parse(log.activeAt) : 0;
  return configured
    .filter((server) => server.enabled)
    .map((server): McpServerStatus => {
      if (log.tools.has(toolPrefix(server.name)))
        return { name: server.name, state: "connected", detail: null };
      if (server.auth_status === "not_logged_in")
        return { name: server.name, state: "needs-auth", detail: null };
      const timeoutMs = (server.startup_timeout_sec ?? DEFAULT_STARTUP_SEC) * 1000;
      return activeAt >= startedAt + timeoutMs + STARTUP_SLACK_MS
        ? { name: server.name, state: "failed", detail: "Didn't connect when the chat started" }
        : { name: server.name, state: "pending", detail: null };
    });
}

/** The ChatGPT apps the chat can use, which Codex serves as one MCP server of its own. */
export const codexApps = (log: CodexLog) =>
  [...log.tools]
    .filter((name) => name.startsWith(APP_PREFIX))
    .map((name) => name.slice(APP_PREFIX.length))
    .sort();
