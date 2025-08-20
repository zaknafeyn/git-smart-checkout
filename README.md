# git-smart-checkout

Link to extension in marketplace https://marketplace.visualstudio.com/items?itemName=vradchuk.git-smart-checkout

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Info

`git-smart-checkout` is a vscode extension that adds a new command `Git: Checkout to ... (With stash)` to command palette that allows to choose stash strategy at checkout.

Comments and contributions are very welcome!

## Motivation

In fast-paced development environments, switching between Git branches is a frequent but often disruptive task. Developers may have uncommitted changes that block a checkout, leading to tedious manual stashing and the risk of losing or misplacing changes. This common friction interrupts focus, breaks workflow, and slows down productivity.

The `git-smart-checkout` VSCode extension was created to eliminate that pain. It provides a seamless way to automatically stash and restore changes when switching branches—so developers can stay in the flow, move confidently between tasks, and trust that their work is safe.

Our goal is simple: make Git smarter, so you don’t have to think about it. `git-smart-checkout` reduces context-switching overhead and gives developers back valuable time and mental clarity. No more “local changes would be overwritten” errors—just smooth, uninterrupted development.

## Checkout modes

### Auto stash in current branch

This mode is useful if you need to keep stash with your branch.
In this mode, extension creates a automatic stash for the current branch (let's call it `branch_1`) before switching to new branch `branch_2`.
When you switch back to `branch_1` with this mode, stash for this branch will be popped automatically.

### Auto stash and pop in new branch

This mode is helpful if you need to transfer your changes to a new branch after checkout.
In this mode, extension creates a stash from working directory, switches to a new branch and then **pop** the stash.

### Auto stash and apply in new branch

This mode is helpful if you need to transfer your changes to a new branch after checkout but want to keep the changes with original branch where changes were originally made.
In this mode, extension creates a stash from working directory, switches to a new branch and then **apply** the stash, e.g. add stashed changes but does not remove them from stash stack.

> [!TIP]
> stash created with this mode is not compatible with the stash created by mode `Auto stash in current branch`, this means that it want be used to automatically restore. This stash might be used for manual access if needed.

> [!TIP]
> you could set default auto stash behavior when using `Checkout to ... (With Stash)` command by changing default mode in status bar. If set to manual, you will be prompted to select auto stash mode after each checkout, otherwise selected auto stash strategy will be used by default.

### No auto stash

This mode is just ordinary checkout without any auto stash functionality.

## Pull with stash

The extension provides a convenient **Pull with stash** feature. When you run this command, your uncommitted changes are automatically stashed before pulling updates from the remote branch. After the pull completes, your changes are restored. This ensures a smooth workflow and prevents conflicts or loss of local changes during a pull operation.

## GitHub PR Clone (BETA)

The extension includes a powerful **GitHub PR Clone** feature that enables developers to create new pull requests by cherry-picking selected commits from existing PRs. This feature is valuable for selective feature adoption and maintain the same feature between different branches.

> [!TIP]
> This feature is in BETA stage, any feedback, suggestions or PRs, are very welcome

### Value and Use Cases

- **Selective feature adoption**: Pick only the commits you need from a large PR without taking unwanted changes
- **Code review workflows**: Create focused PRs from larger feature branches for easier review
- **Bug fix extraction**: Extract specific bug fixes from feature branches to hotfix branches
- **Collaborative development**: Build upon others' work by cherry-picking their commits into your branch
- **Version control**: Maintain clean commit history by selecting only relevant changes

### How it works

1. **Initiate PR Clone**: Use the `Git: Clone pull request...` command from the command palette
2. **Select Target PR**: Choose the GitHub pull request you want to clone from
3. **Configure Options**:
   - Select target branch (where your new PR will be merged)
   - Choose feature branch name for your new PR
   - Add description for the new PR
   - Select specific commits to cherry-pick
4. **Cherry-pick Process**: The extension automatically:
   - Stashes any uncommitted changes in your workspace
   - Switches to the target branch and pulls latest changes
   - Creates a new feature branch
   - Cherry-picks selected commits one by one
   - Handles conflicts with user interaction when needed
5. **Conflict Resolution**: When conflicts occur during cherry-picking, you have three options:
   - **Resolve**: Fix conflicts manually and continue
   - ~~**Skip**: Skip the problematic commit and continue with the next one~~ (still in development)
   - **Cancel**: Abort the entire process and restore original state
6. **PR Creation**: Once all commits are processed, the extension automatically creates a new GitHub pull request or draft

The entire process is tracked with progress indicators and can be safely cancelled at any point, ensuring your workspace is restored to its original state.
