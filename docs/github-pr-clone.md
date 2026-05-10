# GitHub PR Clone

Command: `Git Smart Checkout: Clone pull request...`

The GitHub PR Clone feature creates a new pull request by cherry-picking selected commits from an existing PR. It is useful for selective feature adoption, focused review workflows, and moving fixes between target branches.

> [!TIP]
> This feature is in beta. Feedback, suggestions, and PRs are very welcome.

## Value and Use Cases

- Select only the commits you need from a large PR without taking unrelated changes.
- Create focused PRs from larger feature branches for easier review.
- Extract specific bug fixes from feature branches to hotfix branches.
- Build upon another contributor's work by cherry-picking commits into your branch.
- Keep commit history clean by selecting only relevant changes.

## How It Works

1. Run `Git Smart Checkout: Clone pull request...` from the command palette.
2. Select the GitHub pull request you want to clone from.
3. Choose the target branch where your new PR should be merged.
4. Choose the feature branch name for your new PR.
5. Add a description for the new PR.
6. Select the commits to cherry-pick.
7. Let the extension create the branch, cherry-pick commits, and create the new PR or draft PR.

During the cherry-pick process, the extension stashes uncommitted workspace changes, switches to the target branch, pulls the latest changes, creates a feature branch, and cherry-picks the selected commits one by one.

## Conflict Handling

When conflicts occur during cherry-picking, you can:

- Resolve conflicts manually and continue.
- Cancel the process and restore the original state.

The process is tracked with progress indicators and can be safely cancelled.

## Related Settings

- `git-smart-checkout.defaultTargetBranch`
- `git-smart-checkout.prBranchPrefix`
- `git-smart-checkout.useInPlaceCherryPick`
