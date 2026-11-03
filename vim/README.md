# paseo-vim

A vim-style normal mode for the [Paseo](https://github.com/getpaseo/paseo) desktop app, so you can drive your coding agents without reaching for the mouse.

Paseo's message box keeps focus almost all the time, so every shortcut needs a modifier and scrolling the chat means grabbing the trackpad. This plugin adds the missing mode: leave the message box with `Ctrl-c`, and bare keys become commands. Scroll the conversation with `j`/`k`, switch tabs with `gt`, cycle workspaces with `Ctrl-j`/`Ctrl-k`, then press `i` to type again.

A small `NORMAL` badge in the bottom-right corner shows when keys are commands, along with any count or half-typed sequence (`3g`).

## Keys

| Keys | Action |
| --- | --- |
| `Ctrl-c` or `Esc` (in the message box) | Normal mode |
| `i` `a` | Back to the message box |
| `j` `k`, `Ctrl-e` `Ctrl-y` | Scroll the chat a little |
| `Ctrl-d` `Ctrl-u` | Scroll half a page |
| `Ctrl-f` `Ctrl-b` | Scroll a page |
| `gg` `G` | Top or bottom of the chat |
| `gt` `gT`, `{n}gt` | Next or previous tab, or tab n |
| `Ctrl-j` `Ctrl-k` (any mode), `]w` `[w` | Next or previous workspace, past Paseo's first-9 limit |
| `Ctrl-w h/j/k/l` | Move to the pane in that direction |
| `Ctrl-w v` `Ctrl-w s` | Split right or down |
| `Ctrl-w q` `Ctrl-w c` | Close the pane |
| `Ctrl-w o` | Maximize or restore the pane |
| `:` `Ctrl-p` `/` | Command Center, file search, find in chat |

Counts work on scrolling and tab movement: `5j`, `3gT`.

It also reopens the right-hand sidebar whenever you navigate to a workspace where it's closed.

## Install

Requires the Paseo desktop app on macOS, version 0.11.2 or later. Plugins are trusted, unsandboxed code, so read the source before installing.

```bash
paseo plugin install git:AntonyToron/paseo-vim
```

Plugins only run when `"pluginsEnabled": true` is set in `~/.paseo/config.json` (then `paseo reload`). Press `Cmd+R` in the Paseo window after installing.

### Esc versus Ctrl-c

Paseo interrupts a running agent on `Esc`, and its handler sees the key before any plugin. Use `Ctrl-c` to leave the message box while an agent is working, or move "Interrupt agent" to another key in Settings → Keyboard shortcuts.

### Ctrl-j and Ctrl-k

If you've bound `Ctrl+J` or `Ctrl+K` to something in Paseo's own shortcut settings, the plugin leaves those keys to Paseo. Clear or reset those shortcuts to let the plugin take over.

## How it works

Paseo has no plugin API for its layout, tabs or keyboard actions, so the plugin works through the page:

- **Modes come from focus.** In the message box you're in insert mode. Nothing focused means normal mode. The terminal, the file editor (which has its own vim setting), other text fields and open dialogs get their keys untouched.
- **Tab, pane and palette commands press Paseo's own shortcuts.** The plugin reads your shortcut settings and sends whatever each action is currently bound to, so rebinds and multi-key sequences like `Ctrl+A n` keep working.
- **Workspace cycling clicks the sidebar rows** instead of using Paseo's shortcut, which stops at the 9th workspace.

Because it finds elements by Paseo's test IDs, a Paseo update can break a command. The selectors live at the top of `client/vim/dom.ts`.

## Limits

- macOS desktop only. On other platforms the plugin turns itself off.
- Workspace cycling needs the left sidebar open, and skips workspaces hidden behind a project's "Show more".
- Moving between messages and visual selection in the chat aren't built yet.

## Development

```bash
npm install
npm run typecheck
npm test
paseo plugin install "$PWD"      # once
paseo plugin reload paseo-vim    # after each change, then Cmd+R in Paseo
```

To see what the plugin decides on each key, open View → Toggle Developer Tools in Paseo and run `localStorage.setItem("paseo-vim:debug", "1")`.

The key-sequence engine (`client/vim/keymap.ts`) and shortcut parsing (`client/vim/shortcuts.ts`) have no browser code and are unit-tested. `client/vim/dom.ts` is the part that talks to the page.

## License

MIT
