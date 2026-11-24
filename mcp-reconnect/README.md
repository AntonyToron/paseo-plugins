# paseo-mcp-reconnect

See which of a [Paseo](https://github.com/getpaseo/paseo) chat's MCP servers are down or need a sign-in, and reconnect them without starting a new session.

Claude's own `/mcp` needs its interactive terminal UI, which Paseo doesn't run, so when an MCP server drops there's no way to reconnect it from inside the chat. This plugin restarts the chat's Claude process instead, keeping the conversation, and then shows which servers came back.

## Usage

Chats whose MCP servers failed or need a sign-in get an **MCP** pill on their composer with how many. Pressing it lists each server's state, with the reason a server failed, and offers:

- **Reconnect** restarts the chat's Claude process, then checks every server and shows what came back. The pill says when it's restarting, and confirms the new process actually opened.
- **Check again** checks every server without restarting anything, the way a new Claude process in that folder would see them (`claude mcp list`, about 20 seconds with two dozen servers).
- **Sign in…** opens a terminal tab running `claude` in the workspace, where `/mcp` can sign servers in. Restarting doesn't fix a server that needs a sign-in. claude.ai connectors link to their settings on claude.ai instead.
- **Ignore** stops a server you don't use from counting, in every chat.

`/mcp-reconnect` in a chat does the same as Reconnect, with the pill showing progress and the result. Both refuse while the chat is mid-turn, because a restart would cut the turn off.

Between checks, the pill follows what Claude records in the chat's transcript whenever its tools change: which servers are still connecting, need a sign-in or failed.

## Codex chats

Codex chats get the same pill. Codex records which servers' tools a chat has in its session log, but nothing about a server that failed, so the plugin compares that with the servers `codex mcp list` says are configured:

- A server that isn't signed in **needs a sign-in**. Its **Sign in** link opens a terminal tab running `codex mcp login <server>`.
- A server that never showed up, though Codex worked on a turn well past the server's startup timeout, **failed**.
- Until then it's **not connected yet**. Codex only notes a server that came up late when the next message starts.

**Reconnect** restarts the chat's Codex process. **Check again** reads the log and the sign-ins again; Codex can't be asked to connect without starting a thread. Codex never records a server dropping, so one that went down mid-chat still shows as connected. The popover also lists the ChatGPT apps the chat can use.

## Install

Requires the Paseo desktop app, version 0.17 or later. Plugins are trusted, unsandboxed code, so read the source before installing.

```bash
paseo plugin install git:AntonyToron/paseo-plugins:mcp-reconnect
```

Press `Cmd+R` in the Paseo window after installing.
