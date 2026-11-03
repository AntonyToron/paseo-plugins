import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const chatThread = z.object({
  agentId: z.string(),
  workspaceId: z.string(),
  url: z.string(),
});
export type ChatThread = z.infer<typeof chatThread>;

export const listThreads = defineRpc({
  name: "slack-thread.list",
  input: z.object({}),
  output: z.object({ threads: z.array(chatThread) }),
});

/** A Slack message permalink: https://team.slack.com/archives/C0123/p1793349625978429 */
const PERMALINK = /https:\/\/[\w-]+\.slack\.com\/archives\/[A-Z0-9]+\/p\d+(?:\?[^\s)>\]]*)?/g;

// A link at the end of a sentence picks up its full stop or comma.
export const lastPermalink = (text: string): string | null =>
  [...text.matchAll(PERMALINK)].at(-1)?.[0].replace(/[.,;:!?]+$/, "") ?? null;

export const checkRepliesPrompt = (url: string) =>
  `Read this Slack thread with your Slack tools and tell me what's new since you last looked at it: ${url}\n\nSummarise the new replies only, and don't post anything in Slack.`;
