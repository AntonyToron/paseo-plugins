# paseo-bg-tasks

A pill for [Paseo](https://github.com/getpaseo/paseo) chats with background tasks still running.

Chats with background tasks still running get a pill on their composer, so a chat that looks idle but is still installing dependencies or waiting on review agents says so. With one task, the pill shows its name; with more, how many. Pressing it lists each task with how long it has been running and, for shell commands, the latest line of its output.

Claude Code notes in the chat's transcript when a background command or agent starts and when it ends, and the plugin reads that. A shell command also counts as running only while some process still has its output file open (checked with `lsof`), so one killed by a restart doesn't linger. Background agents stop with Paseo's daemon, so one started before the daemon's last start is treated as gone.

Only the end of a long transcript is read the first time, and after that only what each chat adds, so a task started early in a very long chat that's still running can be missed.

## Install

Requires the Paseo desktop app, version 0.11.2 or later, on macOS or Linux (for `lsof`). Plugins are trusted, unsandboxed code, so read the source before installing.

```bash
paseo plugin install git:AntonyToron/paseo-plugins:bg-tasks
```

Press `Cmd+R` in the Paseo window after installing.
