The pull requests that need you, in one screen, from **PR inbox** in the sidebar. The badge counts what to look at first plus your own PRs that need you. It has three tabs:

- **Needs you**: the sections below.
- **My PRs**: every open PR of yours, drafts included, each with where it stands; the ones that need you come first.
- **Find a PR**: search PR titles in your orgs, or paste a link, `owner/repo#123` or `#123`, plus the PRs you've recently opened for review. A result opens straight into the review screen.

The **Needs you** tab:

- **Look at these first**: review requests labelled High Priority; ones that look security-related (auth, access, tokens, 2FA, permissions, rate limits, leaks) unless marked Low Priority; and Medium Priority ones that have waited on you more than 5 days with nobody else having approved them. Each says why it's there.
- **Your PRs**: only the ones where you have something to do. That's feedback from a person left after your last push or reply, failing checks, or an approval that's ready to merge. Bots don't count as feedback, and drafts only show for feedback.
- **Review requests**: the rest of what's waiting on you, oldest first, with what other reviewers have already said. Drafts never appear.
- **Stale requests**: requests over 30 days old that aren't urgent, folded away.

Press a row to open the PR on GitHub. **Start review** opens a new chat in that repo's Paseo project with `/pr-review <url>`, using the checkout and settings of your most recent review chat. The repo needs a Paseo project whose git remote points at it.

Priority comes from the repo's **High / Medium / Low Priority** labels. Everything comes from `gh` on the machine running Paseo, refreshed every couple of minutes.

## Reviewing files

**Files** on any inbox row, or `/review-files <PR URL or number>` in a chat, opens a PR's diff the way GitHub's Files changed tab shows it: every file in one scroll, in red and green, with a file tree on the left that jumps to a file. The tree shows folders as GitHub's does, each with how many files it holds, so a crowded folder stands out.

- Claude Haiku sorts the source files into **Core**, **Supporting** and **Trivial**, in the order to read them, with a line under each file on what changed in it. It reads each file's size and the start of its diff, runs once per push, and takes a minute or two on a big PR. **Reading order** in the tree lists the files the same way.
- Core, Supporting and config files are open. Trivial files, **Tests** and **Generated and lockfiles** start folded, since they're most of a big PR's lines; **Show** opens them.
- Each file's **Viewed** tick is GitHub's own, so it matches the Files tab both ways. Ticking a file folds it, as on GitHub, and viewed files start folded and greyed out in the tree. A file that changed after you viewed it says so and opens again. **Mark all viewed** clears a section.
- Diffs come from a local copy of the repo that the plugin keeps to itself (bare, with file contents fetched only when a diff needs them), so big files open instantly and your own checkouts are never touched.

## Claude's check

Requests that have waited two days or more, and aren't already at the top, get a quick read by Claude Haiku on your Claude subscription. It reads the PR's description and searches Slack once for messages about the PR. If someone is waiting on the review, asked for it, or the PR blocks a release or a customer, it moves to **Look at these first** with Claude's reason and a **Slack** button for the message. If the review looks covered by someone else, the row gets a note instead. It never hides a request.

Each PR is checked again when it changes, or after a day. The check runs `claude -p` in the background, two PRs at a time, and its only tool is Slack's read-only search. It keeps no transcript and deletes the Slack results Claude Code saves along the way. It needs the Claude Code CLI signed in, and Slack connected to your Claude account.
