# Status Bar Quick Actions

Command: `Git Smart Checkout: Quick Actions`

Clicking the extension status bar item opens a quick-pick menu that gathers the
most common Git Smart Checkout commands in one place, turning the status item
into a hub for the extension. You can also open it from the command palette.

## Actions

| Group | Action | Runs |
| --- | --- | --- |
| Stash mode | Switch stash mode | `Git Smart Checkout: Switch Mode` (the current mode is shown in the description) |
| Checkout | Checkout to… | `Git Smart Checkout: Checkout to ... (With Stash)` |
| Checkout | Checkout previous branch | `Git Smart Checkout: Checkout previous branch (With Stash)` |
| Checkout | Checkout by PR number… | `Git Smart Checkout: Checkout by PR number... (With Stash)` |
| Update branch | Pull (With Stash) | `Git Smart Checkout: Pull (With Stash)` |
| Update branch | Pull (Rebase With Stash) | `Git Smart Checkout: Pull (Rebase With Stash)` |
| Update branch | Rebase (With Stash) | `Git Smart Checkout: Rebase ... (With Stash)` |
| Worktree | Move to new worktree | `Git Smart Checkout: Move to new worktree` |
| GitHub | Clone pull request… | `Git Smart Checkout: Clone pull request...` |

Selecting an action runs the underlying command, so each step behaves exactly as
it does from the command palette. Dismissing the menu (for example with `Esc`)
does nothing.

## Status Bar

The status bar item shows the current stash mode and opens this menu on click.
Switching the stash mode is available as the first action. Hide the status bar
item with:

```json
"git-smart-checkout.showStatusBar": false
```
