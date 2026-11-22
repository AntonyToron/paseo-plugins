import type { PluginServerContext } from "@getpaseo/plugin/server";
import { getDashSnapshot } from "./shared/contracts";
import { getSnapshot } from "./server/snapshot";
import { addWorktreeNudge } from "./server/worktree-nudge";

export default function contribute(server: PluginServerContext) {
  server.handle(getDashSnapshot, getSnapshot);
  const removeNudge = addWorktreeNudge(server);
  return () => removeNudge();
}
