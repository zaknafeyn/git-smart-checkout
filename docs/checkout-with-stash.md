# Checkout with Stash

Command: `Git: Checkout to ... (With Stash)`

Use this command to switch to a local branch, remote branch, or tag while the extension protects your uncommitted changes according to the selected stash mode.

## What It Does

1. Opens a branch picker for local branches, remote branches, and tags.
2. Lets you star preferred refs so they stay easy to find in this repository.
3. Uses the configured stash mode, or asks you to choose one when the mode is `manual`.
4. Checks out the selected ref.
5. Pulls the branch after checkout when the selected branch has an upstream.
6. Restores or transfers local changes depending on the stash mode.

When `git-smart-checkout.useFastBranchList` is enabled, the picker opens quickly from VS Code's cached Git model and enriches the list in the background. Enable `git-smart-checkout.refetchBeforeCheckout` when you want the extension to fetch remotes before showing the final branch list.

## Stash Modes

| Mode | Behavior |
| --- | --- |
| Auto stash in current branch | Stashes changes for the current branch before checkout. When you later return to that branch with the same mode, the matching stash is popped automatically. |
| Auto stash and pop in new branch | Stashes current changes, checks out the target branch, then pops the stash onto the target branch. |
| Auto stash and apply in new branch | Stashes current changes, checks out the target branch, then applies the stash onto the target branch while keeping the stash entry available. |
| No auto stash | Runs checkout without automatic stash handling. Git may block the checkout if local changes would be overwritten. |

> [!TIP]
> Set the default behavior with `Git: Switch Mode` or the status bar item. When the mode is `manual`, this command asks you to select a stash mode each time.

> [!TIP]
> Stashes created by "Auto stash and apply in new branch" are not used by the automatic branch-restore flow. They remain available for manual stash access.

## Conflict Pre-Flight

For auto stash and pop/apply modes, Git 2.38 or newer allows the extension to preview stash conflicts before switching branches. If conflicts are predicted, you can cancel before the checkout changes your working tree.

## Media

![Auto stash in current branch](media/autostash_in_current_branch.png)

[Auto stash in current branch video](media/autostash_in_current_branch.mov)
