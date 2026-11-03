# paseo-resume

A [Paseo](https://github.com/getpaseo/paseo) plugin that brings back the Claude chats a restart or crash cut off mid-turn.

After a restart or a crash, a "Resume N interrupted chats" row appears at the top of the sidebar. It lists the Claude chats that were cut off mid-turn: ones that stopped in the middle of a tool call, or before answering your last message. Press **Continue all** to send each one "continue", or **Skip** any you'd rather check first. The row disappears once nothing is left.

A chat counts as cut off when its transcript stops mid-turn and either that happened before the daemon last started, or its Claude process died and left it in an error state. Chats you stopped yourself, chats that are still running, and anything older than a day are left alone. Skipping a chat hides it until it moves on.

## Install

Requires the Paseo desktop app, version 0.11.2 or later. Plugins are trusted, unsandboxed code, so read the source before installing.

```bash
paseo plugin install git:AntonyToron/paseo-plugins:resume
```

Press `Cmd+R` in the Paseo window after installing.
