import { execCommand, type PluginServerContext } from "@getpaseo/plugin/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { worktreeNudge } from "../shared/worktree-nudge";

/** The checkout's root when `cwd` is a main checkout (not a linked worktree) with worktree setup in paseo.json. */
export async function mainCheckoutWithWorktreeSetup(cwd: string): Promise<string | null> {
  const { stdout } = await execCommand(
    "git",
    ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-dir", "--git-common-dir"],
    { cwd, timeout: 5_000 },
  ).catch(() => ({ stdout: "" }));
  const [root, gitDir, commonDir] = stdout.trim().split("\n");
  if (!root || !gitDir || gitDir !== commonDir) return null;
  try {
    const config = JSON.parse(await readFile(join(root, "paseo.json"), "utf8")) as {
      worktree?: unknown;
    };
    return config.worktree ? root : null;
  } catch {
    return null;
  }
}

export function addWorktreeNudge(server: PluginServerContext) {
  return server.addHook("agent.open.before", async ({ request }) => {
    if (request.background || request.purpose !== "interactive") return;
    const checkout = await mainCheckoutWithWorktreeSetup(request.cwd);
    if (!checkout) return;
    return {
      ...request,
      appendSystemPrompt: [
        ...(request.appendSystemPrompt ?? []),
        worktreeNudge(checkout, request.provider),
      ],
    };
  });
}
