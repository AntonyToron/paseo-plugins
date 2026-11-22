import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mainCheckoutWithWorktreeSetup } from "../server/worktree-nudge";

function repo(paseoJson?: object): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "nudge-")));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
  git("init", "-q", "-b", "main");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init");
  if (paseoJson) writeFileSync(join(root, "paseo.json"), JSON.stringify(paseoJson));
  return root;
}

describe("mainCheckoutWithWorktreeSetup", () => {
  it("picks a main checkout whose paseo.json sets up worktrees", async () => {
    const root = repo({ worktree: { setup: "true" } });
    expect(await mainCheckoutWithWorktreeSetup(root)).toBe(root);
  });

  it("leaves out linked worktrees, repos without worktree setup, and folders outside git", async () => {
    const root = repo({ worktree: { setup: "true" } });
    const linked = join(root, "..", `${root.split("/").pop()}-wt`);
    execFileSync("git", ["worktree", "add", "-q", "-b", "feature", linked], {
      cwd: root,
      stdio: "ignore",
    });
    expect(await mainCheckoutWithWorktreeSetup(linked)).toBeNull();
    expect(await mainCheckoutWithWorktreeSetup(repo({ scripts: {} }))).toBeNull();
    expect(await mainCheckoutWithWorktreeSetup(repo())).toBeNull();
    expect(
      await mainCheckoutWithWorktreeSetup(realpathSync(mkdtempSync(join(tmpdir(), "plain-")))),
    ).toBeNull();
  });
});
