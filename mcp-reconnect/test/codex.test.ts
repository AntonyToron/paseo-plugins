import { describe, expect, it } from "vitest";
import {
  codexApps,
  codexServers,
  emptyCodexLog,
  readCodexLine,
  type CodexConfiguredServer,
} from "../shared/codex";

// Trimmed from a real Codex session log.
const lines = [
  JSON.stringify({
    timestamp: "2026-11-24T14:36:14.277Z",
    type: "session_meta",
    payload: { id: "t", timestamp: "2026-11-24T14:36:13.958Z" },
  }),
  JSON.stringify({
    timestamp: "2026-11-24T14:36:16.363Z",
    type: "world_state",
    payload: {
      full: true,
      state: {
        tools: {
          mcp__github: "",
          mcp__linear_server: "",
          mcp__codex_apps__slack: "",
          functions: "",
        },
      },
    },
  }),
  JSON.stringify({
    timestamp: "2026-11-24T14:36:24.790Z",
    type: "world_state",
    payload: { full: false, state: { tools: { mcp__playwright: "" } } },
  }),
];

const server = (
  name: string,
  extra: Partial<CodexConfiguredServer> = {},
): CodexConfiguredServer => ({
  name,
  enabled: true,
  auth_status: "unsupported",
  startup_timeout_sec: null,
  ...extra,
});

const configured = [
  server("github"),
  server("linear-server", { auth_status: "o_auth" }),
  server("playwright"),
  server("notion", { auth_status: "not_logged_in" }),
  server("aws-mcp"),
  server("computer-use", { enabled: false }),
];

function logWith(...extra: string[]) {
  const log = emptyCodexLog();
  for (const line of [...lines, ...extra]) readCodexLine(log, line);
  return log;
}

const turnAt = (timestamp: string) =>
  JSON.stringify({ timestamp, type: "event_msg", payload: { type: "task_started" } });

describe("codexServers", () => {
  it("reads connected servers from the tool lists, with Codex's underscored names", () => {
    const states = Object.fromEntries(
      codexServers(logWith(), configured, null).map((entry) => [entry.name, entry.state]),
    );
    expect(states).toEqual({
      github: "connected",
      "linear-server": "connected",
      playwright: "connected",
      notion: "needs-auth",
      "aws-mcp": "pending",
    });
  });

  it("calls a missing server failed once Codex worked on a turn past its startup timeout", () => {
    const aws = (log: ReturnType<typeof logWith>, openedAt: number | null = null) =>
      codexServers(log, configured, openedAt).find((entry) => entry.name === "aws-mcp")?.state;
    expect(aws(logWith(turnAt("2026-11-24T14:36:20.000Z")))).toBe("pending");
    expect(aws(logWith(turnAt("2026-11-24T14:40:00.000Z")))).toBe("failed");
    // A restart starts the clock again.
    expect(
      aws(logWith(turnAt("2026-11-24T14:40:00.000Z")), Date.parse("2026-11-24T14:39:58.000Z")),
    ).toBe("pending");
  });

  it("starts over at a full tool list and lists ChatGPT apps on their own", () => {
    const log = logWith(
      JSON.stringify({
        timestamp: "2026-11-24T15:00:00.000Z",
        type: "world_state",
        payload: {
          full: true,
          state: { tools: { mcp__github: "", mcp__codex_apps__datadog: "" } },
        },
      }),
    );
    expect([...log.tools].sort()).toEqual(["mcp__codex_apps__datadog", "mcp__github"]);
    expect(codexApps(log)).toEqual(["datadog"]);
  });
});
