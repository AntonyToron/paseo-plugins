Every open workspace in two lines, grouped by what it needs from you: **Needs you**, **Re-look**, **Working**, **Unread**, **Waiting** and **Done**. The sidebar's Dash row counts what needs you or needs a re-look.

Each workspace is tied to the PR it's about: the one its title names (Paseo titles a workspace from its first message), else the last PR you linked in it, it created, or it changed. Read-only lookups don't count, since agents look up neighbouring PRs all the time. This works for review workspaces that share one checkout, which Paseo itself links to the checkout branch's PR.

A PR lands in **Re-look** when it has commits or comments from someone else since the chat last finished a turn. **Re-review** asks that same chat to review just what changed, so it keeps its context. Merged and closed PRs, and finished chats you've seen, go to **Done**, where **Archive all** clears them. Worktrees with uncommitted or unpushed work are kept back and named.

Someone else's draft PR isn't asking for review yet, so its workspace stays off the dash until the PR is marked ready, and then anything pushed meanwhile shows as new. It still appears while its chat needs you, is working, or has results you haven't seen. Your own drafts always show.

PR details come from `gh` on the machine running Paseo, so it must be installed and signed in there.
