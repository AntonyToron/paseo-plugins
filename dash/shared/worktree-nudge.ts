/**
 * Told to chats that open in a repo's main checkout, where Paseo can set up worktrees: new
 * branches go to their own worktree workspace, so each piece of work gets its own branch,
 * Changes, PR link and scripts, and archiving the workspace cleans up after it.
 */
export function worktreeNudge(checkout: string, provider: string): string {
  return `## Branches go in their own worktree workspace

You're running in ${checkout}, this repo's main checkout, which other chats share. Don't create or switch branches here to start new work: the workspace's branch, Changes and PR link follow this checkout, and another chat may be using it.

When the user asks for work that needs a branch of its own (a feature, a fix, anything that becomes a PR) and this checkout isn't already on a branch for that work, start it in a new worktree workspace and stop:

\`\`\`bash
cd ${checkout}
paseo run --new-workspace worktree --worktree-mode branch-off --new-branch <branch> --base <base> --no-wait \\
  --title "<short title>" --provider ${provider} --model <model> --thinking <thinking> --mode <mode> \\
  "<the request, with the context you've gathered, since the new chat starts fresh>"
\`\`\`

Name the branch and choose the base the way this repo does. For an existing branch use \`--worktree-mode checkout-branch --branch <name>\`, and for an open PR \`--worktree-mode checkout-pr --pr-number <n>\`. Git keeps a branch in one worktree at a time, so if a Paseo workspace already has the branch (\`paseo workspace ls --json\`), run there with \`--workspace <id>\` instead. Copy model, thinking and mode from this chat (\`paseo inspect "$PASEO_AGENT_ID"\`). Paseo runs the repo's worktree setup, and archiving the workspace removes the worktree.

Then reply in one line, naming the new workspace. Questions, investigation and read-only work stay in this chat, and so do work on the branch this checkout is already on and anything the user says to do here.`;
}
