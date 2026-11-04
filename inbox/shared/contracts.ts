import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { inboxSnapshot } from "./model";

export const getInbox = defineRpc({
  name: "inbox.snapshot",
  /** refresh skips the shared cache and asks GitHub now. */
  input: z.object({ refresh: z.boolean().optional() }),
  output: inboxSnapshot,
});

export const startReview = defineRpc({
  name: "inbox.start-review",
  input: z.object({ repo: z.string(), number: z.number(), title: z.string(), url: z.string() }),
  output: z.object({ agentId: z.string() }),
});
