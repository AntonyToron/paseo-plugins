# paseo-chat-search

Full-text search over your [Paseo](https://github.com/getpaseo/paseo) Claude chats.

Find a past chat by what was said in it. Open **Search chats** from the sidebar or the Command Center and type a few words: every chat that mentions all of them comes back, archived ones included, with the line that matched. Press a result to open that chat.

Paseo's own Search matches chat titles and files; this one reads what you and Claude wrote. Chats where the exact phrase or all the words appear in one message rank first, and your own messages count a little more than Claude's.

It keeps a small index of the messages only, not tool output or screenshots, under the plugin's data folder. The first index takes a few seconds to a minute; after that it only reads what's new.

## Install

Requires the Paseo desktop app, version 0.11.2 or later. Plugins are trusted, unsandboxed code, so read the source before installing.

```bash
paseo plugin install git:AntonyToron/paseo-plugins:chat-search
```

Press `Cmd+R` in the Paseo window after installing.
