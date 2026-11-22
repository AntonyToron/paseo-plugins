export type McpState = "connected" | "needs-auth" | "failed" | "pending";

export interface McpServerStatus {
  name: string;
  state: McpState;
  /** Why it failed, when Claude says. */
  detail: string | null;
}

/**
 * Reads `claude mcp list`, one server a line:
 *   github: https://api.githubcopilot.com/mcp (HTTP) - ✔ Connected
 *   notion: https://mcp.notion.com/mcp (HTTP) - ! Needs authentication
 *   aws-mcp: uvx … - ! Connected · tools fetch failed — No AWS credentials available.
 * Names can hold colons (`plugin:slack:slack`) but not ": ", so the name ends at the first one.
 */
export function parseMcpList(output: string): McpServerStatus[] {
  const servers: McpServerStatus[] = [];
  for (const line of output.split("\n")) {
    const nameEnd = line.indexOf(": ");
    const statusStart = line.lastIndexOf(" - ");
    if (nameEnd <= 0 || statusStart <= nameEnd) continue;
    const name = line.slice(0, nameEnd).trim();
    const status = line.slice(statusStart + 3).trim();
    if (status.startsWith("✔")) servers.push({ name, state: "connected", detail: null });
    else if (/needs authentication/i.test(status))
      servers.push({ name, state: "needs-auth", detail: null });
    else if (/^[!✗]/.test(status)) {
      // "Connected · tools fetch failed — <why>" connects but gives the chat no tools.
      const why = status.split(/\s+—\s+/)[1] ?? status.replace(/^[!✗]\s*/, "");
      servers.push({ name, state: "failed", detail: why.trim() || null });
    }
  }
  return servers;
}

interface DeferredToolsDelta {
  type?: string;
  pendingMcpServers?: string[];
  needsAuthMcpServers?: string[];
  failedMcpServers?: { name: string; errorCode?: string; error?: string }[];
}

/**
 * When a chat's tools change, Claude Code records in its transcript every MCP server that is still
 * connecting, needs a sign-in or failed, so the latest such record is the chat's current state.
 * Connected servers aren't listed. Null for any other line.
 */
export function problemsFromTranscriptLine(
  line: string,
): { at: string; servers: McpServerStatus[] } | null {
  if (!line.includes('"deferred_tools_delta"')) return null;
  let record: { timestamp?: string; attachment?: DeferredToolsDelta };
  try {
    record = JSON.parse(line) as typeof record;
  } catch {
    return null;
  }
  const delta = record.attachment;
  if (delta?.type !== "deferred_tools_delta" || !record.timestamp) return null;
  return {
    at: record.timestamp,
    servers: [
      ...(delta.needsAuthMcpServers ?? []).map((name) => ({
        name,
        state: "needs-auth" as const,
        detail: null,
      })),
      ...(delta.failedMcpServers ?? []).map((server) => ({
        name: server.name,
        state: "failed" as const,
        detail: server.error ?? server.errorCode ?? null,
      })),
      ...(delta.pendingMcpServers ?? []).map((name) => ({
        name,
        state: "pending" as const,
        detail: null,
      })),
    ],
  };
}
