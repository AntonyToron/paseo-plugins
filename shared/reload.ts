import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const reloadAgentRpc = defineRpc({
  name: "agent.reload",
  input: z.object({ agentId: z.string().min(1) }),
  output: z.object({ agentId: z.string() }),
});
