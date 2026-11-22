Chats whose MCP servers failed or need a sign-in get an **MCP** pill on their composer with how many. Pressing it lists each server's state, with the reason a server failed, and offers:

- **Reconnect** restarts the chat's Claude process, keeping the conversation, then checks every server and shows what came back. The pill says when it's restarting, and confirms the new process actually opened.
- **Check again** checks every server without restarting anything, the way a new Claude process in that folder would see them.
- **Sign in…** opens a terminal tab running `claude` in the workspace, where `/mcp` can sign servers in. Restarting doesn't fix a server that needs a sign-in. claude.ai connectors link to their settings on claude.ai instead.
- **Ignore** stops a server you don't use from counting, in every chat.

`/mcp-reconnect` in a chat does the same as Reconnect, with the pill showing progress and the result.

Between checks, the pill follows what Claude records in the chat's transcript whenever its tools change: which servers are still connecting, need a sign-in or failed.
