import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const interruptedChat = z.object({
  agentId: z.string(),
  title: z.string(),
  cutOffAt: z.string(),
  /** What the turn was doing when it stopped, e.g. "running Bash" or "waiting for a reply". */
  lastStep: z.string(),
});
export type InterruptedChat = z.infer<typeof interruptedChat>;

export const listInterrupted = defineRpc({
  name: "resume.list",
  input: z.object({}),
  output: z.object({ chats: z.array(interruptedChat) }),
});

export const continueChats = defineRpc({
  name: "resume.continue",
  input: z.object({ agentIds: z.array(z.string()).min(1) }),
  output: z.object({
    continued: z.array(z.string()),
    failed: z.array(z.object({ agentId: z.string(), error: z.string() })),
  }),
});

export const dismissChats = defineRpc({
  name: "resume.dismiss",
  input: z.object({ agentIds: z.array(z.string()).min(1) }),
  output: z.object({ dismissed: z.number() }),
});
