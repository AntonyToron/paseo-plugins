import { describe, expect, it } from "vitest";
import { applyLine, emptyScan } from "../shared/scan";

const line = (record: unknown) => JSON.stringify(record);

const shellCall = (id: string, description: string) =>
  line({
    message: {
      content: [
        {
          type: "tool_use",
          id,
          name: "Bash",
          input: { command: "yarn install", description, run_in_background: true },
        },
      ],
    },
  });

const shellStarted = (callId: string, taskId: string) =>
  line({
    timestamp: "2026-11-05T08:30:00.000Z",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: callId,
          content: `Command running in background with ID: ${taskId}. Output is being written to: /tmp/tasks/${taskId}.output. You will be notified when it completes.`,
        },
      ],
    },
    toolUseResult: { backgroundTaskId: taskId },
  });

const agentStarted = (callId: string, agentId: string) =>
  line({
    timestamp: "2026-11-05T08:31:00.000Z",
    message: {
      content: [{ type: "tool_result", tool_use_id: callId, content: "Async agent launched" }],
    },
    toolUseResult: { isAsync: true, agentId, description: "Security review" },
  });

const notification = (taskId: string) =>
  line({
    type: "queue-operation",
    content: `<task-notification>\n<task-id>${taskId}</task-id>\n<status>completed</status>\n</task-notification>`,
  });

describe("applyLine", () => {
  it("tracks a background command from its start to its notification", () => {
    const scan = emptyScan();
    applyLine(scan, shellCall("toolu_1", "Install dependencies"));
    applyLine(scan, shellStarted("toolu_1", "b1"));
    expect(scan.started.b1).toEqual({
      id: "b1",
      kind: "shell",
      description: "Install dependencies",
      startedAt: "2026-11-05T08:30:00.000Z",
      outputFile: "/tmp/tasks/b1.output",
    });
    expect(scan.calls).toEqual({});
    applyLine(scan, notification("b1"));
    expect(scan.started).toEqual({});
  });

  it("tracks a background agent, and a task stopped by hand", () => {
    const scan = emptyScan();
    applyLine(scan, agentStarted("toolu_2", "a1"));
    expect(scan.started.a1?.description).toBe("Security review");
    applyLine(
      scan,
      line({
        message: {
          content: [
            { type: "tool_use", id: "toolu_3", name: "TaskStop", input: { task_id: "a1" } },
          ],
        },
      }),
    );
    expect(scan.started).toEqual({});
  });

  it("ignores other lines and text that only mentions notifications", () => {
    const scan = emptyScan();
    applyLine(scan, shellCall("toolu_1", "Install"));
    applyLine(scan, shellStarted("toolu_1", "b1"));
    applyLine(scan, "not json");
    applyLine(
      scan,
      line({ message: { content: "A <task-notification> arrives when it completes." } }),
    );
    expect(Object.keys(scan.started)).toEqual(["b1"]);
  });
});
