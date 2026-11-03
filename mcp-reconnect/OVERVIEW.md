Type `/mcp-reconnect` in an agent's composer to reconnect its MCP servers without starting a new session.

Claude's own `/mcp` needs the interactive terminal UI, which Paseo doesn't run. This command reloads the agent instead: Paseo stops the Claude process along with its MCP servers and resumes the same conversation in a fresh process. Claude reads its MCP config and stored OAuth tokens again on startup, so a server you just authenticated in a terminal `claude` session comes back connected.

It is the same as "Reload agent" in the tab menu or Command Center. It refuses while the agent is mid-turn, because a reload would interrupt it.
