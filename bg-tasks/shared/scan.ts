/**
 * Background tasks in a Claude Code transcript. A task starts with a tool result that carries a
 * `backgroundTaskId` (a shell command) or `isAsync` with an `agentId` (an agent), and ends with a
 * `<task-notification>` naming its id, or with a TaskStop or KillShell call.
 */

export type TaskKind = "shell" | "agent";

export interface StartedTask {
  id: string;
  kind: TaskKind;
  description: string;
  startedAt: string;
  /** Where a shell task writes its output; open while it runs. */
  outputFile: string | null;
}

export interface TaskScan {
  started: Record<string, StartedTask>;
  /** Tool calls seen but not yet answered, so a result can pick up its call's description. */
  calls: Record<string, string>;
}

export const emptyScan = (): TaskScan => ({ started: {}, calls: {} });

interface Block {
  type?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown;
}

interface TranscriptRecord {
  timestamp?: string;
  message?: { content?: unknown };
  toolUseResult?: unknown;
}

const NOTIFICATION = /<task-id>([\w-]+)<\/task-id>/g;
const OUTPUT_FILE = /Output is being written to: (\S+?\.output)/;
const DESCRIPTION_CHARS = 80;

const text = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((part) => (part as { text?: string }).text ?? "").join("")
      : "";

const describe = (name: string | undefined, input: Record<string, unknown> | undefined) => {
  const said = input?.description ?? input?.command ?? input?.prompt ?? name ?? "Background task";
  return String(said).split("\n")[0]!.slice(0, DESCRIPTION_CHARS);
};

/** Reads one transcript line into the scan. Lines are JSON; anything else is skipped. */
export function applyLine(scan: TaskScan, line: string) {
  // Notifications appear in several record shapes (queued, attached, delivered), so they're
  // matched in the raw line: any of them means the task is over.
  if (line.includes("<task-notification>"))
    for (const match of line.matchAll(NOTIFICATION)) delete scan.started[match[1]!];
  if (!line.includes('"tool_use') && !line.includes("toolUseResult")) return;
  let record: TranscriptRecord;
  try {
    record = JSON.parse(line) as TranscriptRecord;
  } catch {
    return;
  }
  const blocks = Array.isArray(record.message?.content) ? (record.message.content as Block[]) : [];
  for (const block of blocks) {
    if (block.type === "tool_use" && block.id) {
      if (block.name === "TaskStop" || block.name === "KillShell") {
        const id = block.input?.task_id ?? block.input?.shell_id;
        if (typeof id === "string") delete scan.started[id];
      }
      scan.calls[block.id] = describe(block.name, block.input);
    }
    if (block.type !== "tool_result" || !block.tool_use_id) continue;
    const description = scan.calls[block.tool_use_id];
    delete scan.calls[block.tool_use_id];
    const result = record.toolUseResult as
      | { backgroundTaskId?: string; isAsync?: boolean; agentId?: string; description?: string }
      | undefined;
    const startedAt = record.timestamp ?? new Date(0).toISOString();
    if (result?.backgroundTaskId)
      scan.started[result.backgroundTaskId] = {
        id: result.backgroundTaskId,
        kind: "shell",
        description: description ?? "Background command",
        startedAt,
        outputFile: OUTPUT_FILE.exec(text(block.content))?.[1] ?? null,
      };
    else if (result?.isAsync && result.agentId)
      scan.started[result.agentId] = {
        id: result.agentId,
        kind: "agent",
        description: result.description ?? description ?? "Background agent",
        startedAt,
        outputFile: null,
      };
  }
}
