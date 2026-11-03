Adds a vim-style normal mode to the Paseo desktop app on macOS. Press Ctrl-c or Esc in the message box to leave it, then drive Paseo from the keyboard; press `i` to type again. A small NORMAL badge in the bottom-right corner shows when keys are commands, along with any count or sequence in progress.

Paseo interrupts a running agent on Esc before any plugin sees the key, so use Ctrl-c to leave the message box while an agent is working.

## Keys

| Keys | Action |
| --- | --- |
| `j` `k`, `Ctrl-e` `Ctrl-y` | Scroll the chat a little |
| `Ctrl-d` `Ctrl-u` | Scroll half a page |
| `Ctrl-f` `Ctrl-b` | Scroll a page |
| `gg` `G` | Jump to the top or bottom of the chat |
| `gt` `gT`, `{n}gt` | Next or previous tab, or tab n |
| `Ctrl-j` `Ctrl-k` (any mode), `]w` `[w` | Next or previous workspace in the sidebar, past the first 9 |
| `Ctrl-w h/j/k/l` | Move to the pane in that direction |
| `Ctrl-w v` `Ctrl-w s` | Split right or down |
| `Ctrl-w q` `Ctrl-w c` | Close the pane |
| `Ctrl-w o` | Maximize or restore the pane |
| `i` `a` | Back to the message box |
| `:` `Ctrl-p` `/` | Command Center, file search, find in chat |

Counts work on scrolling and tab movement, for example `5j` or `3gT`.

## Limits

The terminal, the file editor and other text fields keep their own keys. Pane and tab keys press whatever Paseo's own shortcut for that action is bound to, including rebinds and multi-key sequences; a shortcut you unassign in Paseo does nothing here either. Paseo has no plugin API for its layout, so the plugin reads the page; a Paseo update can change it.
