# paseo-slack-thread

A Slack thread pill for [Paseo](https://github.com/getpaseo/paseo) chats that start from a Slack link.

Chats that start from a Slack thread get a **Slack thread** pill on their composer. The pill's menu opens the thread in Slack, or asks the chat to check it for new replies: the chat reads the thread with its own Slack tools and sums up what's new, without posting anything.

The pill follows the last Slack message link you typed in the chat. Links the agent wrote or that came from other chats don't count. The plugin has no Slack access of its own and needs no token: checking for replies is the chat's own Slack connection at work.

## Install

Requires the Paseo desktop app, version 0.11.2 or later, and a Slack MCP connected to Claude for reply checks. Plugins are trusted, unsandboxed code, so read the source before installing.

```bash
paseo plugin install git:AntonyToron/paseo-plugins:slack-thread
```

Press `Cmd+R` in the Paseo window after installing.
