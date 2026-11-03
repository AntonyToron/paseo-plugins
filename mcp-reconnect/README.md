# paseo-mcp-reconnect

A `/mcp-reconnect` slash command for the [Paseo](https://github.com/getpaseo/paseo) desktop app, so a Claude agent can get its MCP servers back without you starting a new session.

Claude's own `/mcp` needs its interactive terminal UI, which Paseo doesn't run, so when an MCP server drops or needs a fresh login there's no way to reconnect it from inside the agent. This plugin reloads the agent instead: Paseo stops the Claude process along with its MCP servers, then resumes the same conversation in a new process. Claude reads its MCP config and saved logins again on startup, so every server comes back connected.

## Usage

Type `/mcp-reconnect` in an agent's message box.

- It reconnects all MCP servers, not one at a time.
- If a server needs you to sign in again, do that first in a terminal `claude` session with `/mcp`, then run `/mcp-reconnect`. The new process picks up the saved login.
- It refuses while the agent is mid-turn, because a reload would interrupt it.

This is the same as "Reload agent" in Paseo's tab menu and Command Center, behind a slash command.

## Install

Requires the Paseo desktop app on macOS, version 0.11.2 or later. Plugins are trusted, unsandboxed code, so read the source before installing.

```bash
paseo plugin install git:AntonyToron/paseo-plugins:mcp-reconnect
```

Plugins only run when `"pluginsEnabled": true` is set in `~/.paseo/config.json` (then `paseo reload`). Press `Cmd+R` in the Paseo window after installing.
