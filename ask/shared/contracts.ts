import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const askChat = defineRpc({
  name: "ask-tab.ask",
  input: z.object({
    fromAgentId: z.string(),
    fromTitle: z.string(),
    toAgentId: z.string(),
    toTitle: z.string(),
    question: z.string().min(1),
  }),
  output: z.object({ ok: z.literal(true) }),
});
