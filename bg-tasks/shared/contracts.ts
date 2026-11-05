import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const runningTask = z.object({
  id: z.string(),
  kind: z.enum(["shell", "agent"]),
  description: z.string(),
  startedAt: z.string(),
  /** A shell task's latest line of output, when it has written any. */
  lastLine: z.string().nullable(),
});
export type RunningTask = z.infer<typeof runningTask>;

export const chatTasks = z.object({
  agentId: z.string(),
  workspaceId: z.string(),
  tasks: z.array(runningTask),
});
export type ChatTasks = z.infer<typeof chatTasks>;

/** Every chat with background tasks still running. */
export const listRunningTasks = defineRpc({
  name: "bg-tasks.list",
  input: z.object({}),
  output: z.object({ chats: z.array(chatTasks) }),
});
