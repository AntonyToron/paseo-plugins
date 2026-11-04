import { execCommand } from "@getpaseo/plugin/server";
import { mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

// Cheap and quick: every job here is a short read and a structured answer.
const MODEL = "claude-haiku-5-5";
const TIMEOUT_MS = 4 * 60_000;

function paseoHome(): string {
  const raw = process.env.PASEO_HOME ?? "~/.paseo";
  if (raw === "~") return homedir();
  return resolve(raw.startsWith("~/") ? join(homedir(), raw.slice(2)) : raw);
}
// Also the folder claude runs in, so it picks up no project's CLAUDE.md or settings.
export const dataDir = () => join(paseoHome(), "plugin-data", "paseo-inbox");

/**
 * Even without a saved transcript, Claude Code keeps large tool results, such as whole Slack
 * search pages, in a folder per session. They're of no use once the job is done, so they go.
 */
async function forgetSession(sessionId: string | undefined) {
  if (!sessionId || !/^[0-9a-f-]{36}$/.test(sessionId)) return;
  const claudeHome = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
  await rm(join(claudeHome, "projects", dataDir().replace(/[^a-zA-Z0-9]/g, "-"), sessionId), {
    recursive: true,
    force: true,
  });
}

/**
 * Runs headless Claude Code on your subscription and returns its structured answer. It gets only
 * the tools named here; anything else it reaches for is refused without a prompt.
 */
export async function runClaude<Result>({
  prompt,
  schema,
  allowedTools = [],
  label,
}: {
  prompt: string;
  schema: object;
  allowedTools?: string[];
  label: string;
}): Promise<Result> {
  await mkdir(dataDir(), { recursive: true });
  const { stdout } = await execCommand(
    "claude",
    [
      "-p",
      "--model",
      MODEL,
      "--no-session-persistence",
      ...(allowedTools.length ? ["--allowedTools", ...allowedTools] : []),
      "--output-format",
      "json",
      "--json-schema",
      JSON.stringify(schema),
      prompt,
    ],
    { cwd: dataDir(), timeout: TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, env: process.env },
  );
  const result = JSON.parse(stdout) as {
    is_error?: boolean;
    result?: string;
    session_id?: string;
    structured_output?: Result;
  };
  await forgetSession(result.session_id);
  if (result.is_error || !result.structured_output) {
    throw new Error(`Claude couldn't ${label}: ${result.result?.slice(0, 200) ?? "no answer"}`);
  }
  return result.structured_output;
}
