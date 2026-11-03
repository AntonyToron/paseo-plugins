import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { inboxSnapshot } from "./model";

export const getInbox = defineRpc({
  name: "inbox.snapshot",
  input: z.object({}),
  output: inboxSnapshot,
});

export const startReview = defineRpc({
  name: "inbox.start-review",
  input: z.object({ repo: z.string(), number: z.number(), title: z.string(), url: z.string() }),
  output: z.object({ agentId: z.string() }),
});
