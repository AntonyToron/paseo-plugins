# paseo-ask-tab

Let one [Paseo](https://github.com/getpaseo/paseo) chat ask another a question and get the answer back.

Ask another chat a question without leaving the one you're in. Type `/ask <question>` in a chat (or pick **Ask another chat** in the Command Center), then pick who to ask: tabs in the same workspace come first, then your other chats.

The chat you picked gets the question with a note saying where it came from. When it finishes answering, its reply arrives in the chat you asked from as a new message, so that chat can carry on with it. Nothing needs to run `paseo send` by hand.

Chats that are working right now can't be picked, because a question sent mid-turn could join that turn and never get an answer of its own. A chat answers one relayed question at a time.

## Install

Requires the Paseo desktop app, version 0.11.2 or later. Plugins are trusted, unsandboxed code, so read the source before installing.

```bash
paseo plugin install git:AntonyToron/paseo-plugins:ask
```

Press `Cmd+R` in the Paseo window after installing.
