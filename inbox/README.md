# inbox

A PR inbox for [Paseo](https://github.com/getpaseo/paseo): what to review first, and what your own PRs need from you.

The pull requests that need you, in one screen, from **PR inbox** in the sidebar. The badge counts what to look at first plus your own PRs that need you.

- **Look at these first**: review requests labelled High Priority; ones that look security-related (auth, access, tokens, 2FA, permissions, rate limits, leaks) unless marked Low Priority; and Medium Priority ones that have waited on you more than 5 days with nobody else having approved them. Each says why it's there.
- **Your PRs**: only the ones where you have something to do. That's feedback from a person left after your last push or reply, failing checks, or an approval that's ready to merge. Bots don't count as feedback, and drafts only show for feedback.
- **Review requests**: the rest of what's waiting on you, oldest first, with what other reviewers have already said. Drafts never appear.
- **Stale requests**: requests over 30 days old that aren't urgent, folded away.

Press a row to open the PR on GitHub. **Start review** opens a new chat in that repo's Paseo project with `/pr-review <url>`, using the checkout and settings of your most recent review chat. The repo needs a Paseo project whose git remote points at it.

Priority comes from the repo's **High / Medium / Low Priority** labels. Everything comes from `gh` on the machine running Paseo, refreshed every couple of minutes.

## Claude's check

Requests that have waited two days or more, and aren't already at the top, get a quick read by Claude Haiku on your Claude subscription. It reads the PR's description and searches Slack once for messages about the PR. If someone is waiting on the review, asked for it, or the PR blocks a release or a customer, it moves to **Look at these first** with Claude's reason and a **Slack** button for the message. If the review looks covered by someone else, the row gets a note instead. It never hides a request.

Each PR is checked again when it changes, or after a day. The check runs `claude -p` in the background, two PRs at a time, and its only tool is Slack's read-only search. It keeps no transcript and deletes the Slack results Claude Code saves along the way. It needs the Claude Code CLI signed in, and Slack connected to your Claude account.

## Install

Requires the Paseo desktop app, version 0.11.2 or later, and the GitHub CLI signed in on the same machine. Plugins are trusted, unsandboxed code, so read the source before installing.

```bash
paseo plugin install git:AntonyToron/paseo-plugins:inbox
```

Press `Cmd+R` in the Paseo window after installing.
