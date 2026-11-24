import { describe, expect, it } from "vitest";
import { pillText } from "../client/summary";
import type { ChatMcp } from "../shared/contracts";
import { parseMcpList, problemsFromTranscriptLine } from "../shared/mcp";

const LIST = [
  "Checking MCP server health…",
  "",
  "claude.ai Zite MCP: https://mcp.fillout.com/mcp - ! Needs authentication",
  "plugin:slack:slack: https://mcp.slack.com/mcp (HTTP) - ✔ Connected",
  "mcp-clickhouse: /opt/homebrew/bin/uv run --with mcp-clickhouse --python 3.10 mcp-clickhouse - ✔ Connected",
  "aws-mcp: uvx mcp-proxy-for-aws@latest https://aws-mcp.us-east-1.api.aws/mcp - ! Connected · tools fetch failed — No AWS credentials available.",
  "figma: http://127.0.0.1:3845/mcp (HTTP) - ✗ Failed to connect",
].join("\n");

describe("parseMcpList", () => {
  it("reads each server's state, names with colons included", () => {
    expect(parseMcpList(LIST)).toEqual([
      { name: "claude.ai Zite MCP", state: "needs-auth", detail: null },
      { name: "plugin:slack:slack", state: "connected", detail: null },
      { name: "mcp-clickhouse", state: "connected", detail: null },
      { name: "aws-mcp", state: "failed", detail: "No AWS credentials available." },
      { name: "figma", state: "failed", detail: "Failed to connect" },
    ]);
  });
});

describe("problemsFromTranscriptLine", () => {
  it("reads the servers Claude recorded as needing sign-in, failed or still connecting", () => {
    const line = JSON.stringify({
      timestamp: "2026-11-22T16:07:02.972Z",
      attachment: {
        type: "deferred_tools_delta",
        needsAuthMcpServers: ["notion"],
        failedMcpServers: [{ name: "aws-mcp", errorCode: "-32603", error: "No AWS credentials" }],
        pendingMcpServers: ["github"],
      },
    });
    expect(problemsFromTranscriptLine(line)).toEqual({
      at: "2026-11-22T16:07:02.972Z",
      servers: [
        { name: "notion", state: "needs-auth", detail: null },
        { name: "aws-mcp", state: "failed", detail: "No AWS credentials" },
        { name: "github", state: "pending", detail: null },
      ],
    });
    expect(problemsFromTranscriptLine('{"type":"user"}')).toBeNull();
  });
});

describe("pillText", () => {
  const chat = (servers: ChatMcp["servers"]): ChatMcp => ({
    agentId: "a",
    workspaceId: "w",
    provider: "claude",
    source: "check",
    at: new Date().toISOString(),
    servers,
    apps: [],
  });
  const notion = { name: "notion", state: "needs-auth" as const, detail: null };
  const aws = { name: "aws-mcp", state: "failed" as const, detail: "no creds" };

  it("counts problems, leaving out ignored servers", () => {
    expect(pillText(chat([notion, aws]), null, new Set())).toMatchObject({
      label: "MCP · 2",
      title: "MCP servers: 1 needs sign-in, 1 failed",
    });
    expect(pillText(chat([notion, aws]), null, new Set(["notion", "aws-mcp"]))).toBeNull();
  });

  it("shows progress, then a recent result even when nothing is wrong", () => {
    expect(pillText(chat([]), { kind: "reconnecting" }, new Set())?.label).toBe("MCP …");
    expect(
      pillText(chat([]), { kind: "done", at: Date.now(), reopened: true }, new Set()),
    ).toMatchObject({ label: "MCP ✓", title: "Reconnected: every MCP server is up" });
    expect(
      pillText(chat([]), { kind: "done", at: Date.now() - 10 * 60_000, reopened: true }, new Set()),
    ).toBeNull();
  });

  it("doesn't call a restart done while servers are still coming up", () => {
    const starting = { name: "playwright", state: "pending" as const, detail: null };
    expect(
      pillText(chat([starting]), { kind: "done", at: Date.now(), reopened: true }, new Set()),
    ).toMatchObject({ label: "MCP …", title: "Still connecting: playwright" });
  });
});
