# Switch Mode

Command: `Git Smart Checkout: Switch Mode`

Use this command, or click the extension status bar item, to change the default stash mode used by checkout-style commands.

## What It Controls

The selected mode is stored in `git-smart-checkout.mode`. It affects:

- `Git Smart Checkout: Checkout to ... (With Stash)`
- `Git Smart Checkout: Checkout previous branch (With Stash)`
- `Git Smart Checkout: Checkout by PR number... (With Stash)`
- `Git Smart Checkout: Rebase ... (With Stash)`, with rebase-specific mode handling

## Modes

| Mode | Configuration value | Behavior |
| --- | --- | --- |
| Manual | `manual` | Ask for the stash mode each time a supported command runs. |
| Auto stash in current branch | `autoStashForBranch` | Keep changes associated with the branch they came from and restore them when returning to that branch. |
| Auto stash and pop in new branch | `autoStashAndPop` | Move current changes to the checked-out branch by popping the stash there. |
| Auto stash and apply in new branch | `autoStashAndApply` | Copy current changes to the checked-out branch by applying the stash while keeping the stash entry. |

For rebase, `autoStashAndPop` and `autoStashAndApply` are treated as "Auto stash in current branch" because rebase does not switch to a different branch.

## Status Bar

The status bar item shows the current mode and opens the same mode picker. Hide it with:

```json
"git-smart-checkout.showStatusBar": false
```
