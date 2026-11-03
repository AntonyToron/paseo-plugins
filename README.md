# paseo-plugins

Plugins for [Paseo](https://github.com/getpaseo/paseo), the desktop app for running coding agents. I run a lot of agents at once, mostly reviewing pull requests, and these fill the gaps I kept hitting. Each folder is its own plugin with its own README.

| Plugin | What it does |
| --- | --- |
| [dash](dash) | Every open workspace in two lines, grouped by what it needs from you. Review chats flag new commits and comments on their PR since they last looked, and a **Re-review** button asks the same chat to review just what changed. |
| [inbox](inbox) | The PRs that need you: High Priority and security reviews first, then your other review requests and your own PRs with feedback you haven't answered. **Start review** opens a review chat for any of them. |
| [chat-search](chat-search) | Search what was said in any chat, archived ones included, instead of just titles. |
| [ask](ask) | `/ask` sends a question to another chat and brings its answer back to the one you asked from. |
| [resume](resume) | After a restart or crash, lists the chats that were cut off mid-turn and continues them in one press. |
| [mcp-reconnect](mcp-reconnect) | `/mcp-reconnect` restarts a chat's Claude process so every MCP server reconnects, keeping the conversation. |
| [slack-thread](slack-thread) | Chats started from a Slack thread get a pill to open it or ask the chat to check for new replies. |
| [vim](vim) | A vim-style normal mode: scroll the chat, switch tabs and move between panes from the keyboard. |

## Install

Each plugin installs on its own from its folder:

```bash
paseo plugin install git:AntonyToron/paseo-plugins:dash
```

They need the Paseo desktop app, version 0.11.2 or later, with `"pluginsEnabled": true` in `~/.paseo/config.json`. Press `Cmd+R` in the Paseo window after installing. Plugins are trusted, unsandboxed code, so read the source before installing.

## Development

```bash
npm install
npm run typecheck
npm test
paseo plugin install "$PWD/dash"    # once per plugin
paseo plugin reload paseo-dash      # after each change, then Cmd+R in Paseo
```

Plugins that need the daemon's filesystem or a CLI (`gh`, `lsof`) do that in their `server/` code; everything the app renders is in `client/`. Most plugins read Claude Code's transcripts on disk, and the readers are built to cope with transcripts of hundreds of megabytes.

## License

MIT
