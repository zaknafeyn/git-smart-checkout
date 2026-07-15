# git-smart-checkout

Website: https://git-smart-checkout.vradchuk.info

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![VS Marketplace](https://vsmarketplacebadges.dev/downloads/vradchuk.git-smart-checkout.png)](https://marketplace.visualstudio.com/items?itemName=vradchuk.git-smart-checkout) [![Open VSX](https://img.shields.io/open-vsx/dt/vradchuk/git-smart-checkout?style=flat&logo=eclipseide)](https://open-vsx.org/extension/vradchuk/git-smart-checkout)

## Requirements

- Git **2.38** or newer is recommended for tracked-file conflict pre-flight detection in auto stash and pop/apply modes. On older Git versions, the extension logs that the preview is unavailable and continues without it; untracked-file conflicts are not previewed.
- GitHub features support HTTPS and SSH GitHub remotes, including repository names that contain dots.

## Info

`git-smart-checkout` is a VS Code extension that adds stash-aware Git commands to the command palette. It helps you switch branches, pull, rebase, clone PR changes, and create tags without manually juggling local changes.

Comments and contributions are very welcome!

## Motivation

In fast-paced development environments, switching between Git branches is frequent but often disruptive. Developers may have uncommitted changes that block a checkout, leading to tedious manual stashing and the risk of losing or misplacing changes. This friction interrupts focus, breaks workflow, and slows down productivity.

`git-smart-checkout` eliminates that pain by automatically stashing and restoring changes around common Git operations. You can stay in flow, move confidently between tasks, and avoid the familiar "local changes would be overwritten" detour.

## Features

All commands are grouped under the `GSC:` prefix in the Command Palette.

| Feature | Command | Details |
| --- | --- | --- |
| Checkout to a branch, tag, or remote ref with configurable stash behavior | `GSC: Checkout to ... (With Stash)` | [Checkout with stash](docs/checkout-with-stash.md) |
| Checkout the previous branch with the same stash behavior | `GSC: Checkout Previous Branch (With Stash)` | [Checkout previous branch with stash](docs/checkout-previous-branch-with-stash.md) |
| Copy the current branch name to the clipboard | `GSC: Copy Current Branch Name to Clipboard` | [Copy current branch name](docs/copy-current-branch-name.md) |
| Checkout a GitHub pull request branch by PR number or URL | `GSC: Checkout by PR Number... (With Stash)` | [Checkout by PR number with stash](docs/checkout-by-pr-number-with-stash.md) |
| Review a GitHub pull request in a linked worktree and remove tracked review worktrees | `GSC: PR Review in Worktree...`, `GSC: Remove PR Review in Worktree...` | [PR review in worktree](docs/pr-review-in-worktree.md) |
| Pull the current branch while preserving local changes | `GSC: Pull (With Stash)` | [Pull with stash](docs/pull-with-stash.md) |
| Pull with rebase while preserving local changes | `GSC: Pull (Rebase With Stash)` | [Pull rebase with stash](docs/pull-rebase-with-stash.md) |
| Rebase the current branch onto another ref while preserving local changes | `GSC: Rebase (With Stash)` | [Rebase with stash](docs/rebase-with-stash.md) |
| Inspect, recover, or remove stashes created by Git Smart Checkout | `GSC: Manage Auto-Stashes...` | [Manage auto-stashes](docs/manage-auto-stashes.md) |
| Copy staged or WIP changes between existing worktrees | `GSC: Copy Staged Changes to Worktree...`, `GSC: Copy WIP Changes to Worktree...`, `GSC: Copy WIP from Worktree...`, `GSC: Move WIP from Worktree...` | [Copy changes to worktree](docs/copy-changes-to-worktree.md) |
| Open a terminal in a selected worktree's directory | `GSC: Open Worktree Dev Terminal...` | [Open worktree dev terminal](docs/open-worktree-dev-terminal.md) |
| Remove several Git worktrees at once with a single confirmation | `GSC: Remove Multiple Worktrees...` | [Remove multiple worktrees](docs/remove-multiple-worktrees.md) |
| Browse all worktrees for the open repositories in a dedicated "Worktrees" view (activity bar), with dirty/ahead-behind/PR-review status and inline Open/Terminal/Copy WIP/Remove actions | *(tree view — right-click an item for Add to Workspace, Copy Path, Reveal in Finder/Explorer)* | — |
| Create a new PR from selected commits in another GitHub PR | `GSC: Clone Pull Request...` | [GitHub PR clone](docs/github-pr-clone.md) |
| Generate and optionally push a tag from a reusable template | `GSC: Create Tag from Template...` | [Create tag from template](docs/create-tag-from-template.md) |
| Create and check out a branch from a template (Jira, file, regex, scripts) | `GSC: Create Branch from Template...` | [Create branch from template](docs/create-branch-from-template.md) |
| Set up Jira credentials (domain, username, and securely stored API token) in one guided flow | `GSC: Init Jira...` | [Create branch from template](docs/create-branch-from-template.md#jira-configuration) |
| Store the Jira API token securely in VS Code Secret Storage | `GSC: Set Jira Token...` | [Create branch from template](docs/create-branch-from-template.md#jira-configuration) |
| Change the default stash mode used by checkout-style commands | `GSC: Switch Mode...` | [Switch mode](docs/switch-mode.md) |
| Open a quick-actions menu of common commands (checkout, pull/rebase, all worktree commands, clone PR, open settings) from the status bar item | `GSC: Quick Actions...` | [Status bar quick actions](docs/status-bar-quick-actions.md) |
| Open this extension's settings | `GSC: Open Settings` | [Status bar quick actions](docs/status-bar-quick-actions.md) |

## Extension Settings

Click a setting ID to open that setting in VS Code.

| Settings.id (Name) | Type | Description |
| --- | --- | --- |
| ⚙️ [`git-smart-checkout.mode`](vscode://settings/git-smart-checkout.mode) (Checkout stash mode) | `string` | Default checkout stash mode. Available values: `manual`, `autoStashForBranch`, `autoStashAndPop`, `autoStashAndApply`. |
| ⚙️ [`git-smart-checkout.logging.enabled`](vscode://settings/git-smart-checkout.logging.enabled) (Logging enabled) | `boolean` | Enables the extension logging output. |
| ⚙️ [`git-smart-checkout.useFastBranchList`](vscode://settings/git-smart-checkout.useFastBranchList) (Use fast branch list) | `boolean` | Seeds branch pickers from VS Code's cached Git model, preloads details for the first visible refs, and keeps a 48-hour details cache. Disable to build branch lists with a full `git for-each-ref` scan. |
| ⚙️ [`git-smart-checkout.recentBranchCount`](vscode://settings/git-smart-checkout.recentBranchCount) (Recent branch count) | `number` | Number of recently checked-out branches shown in a "Recent" section at the top of the `Checkout to...` picker, ranked by frequency and recency. Set to `0` to disable the section. Default `5`. |
| ⚙️ [`git-smart-checkout.defaultTargetBranch`](vscode://settings/git-smart-checkout.defaultTargetBranch) (Default target branch) | `string` | Default target branch for PR cloning. Leave empty to use the first available branch. |
| ⚙️ [`git-smart-checkout.defaultWorktreeDirectory`](vscode://settings/git-smart-checkout.defaultWorktreeDirectory) (Default worktree directory) | `string` | Directory where PR clone temporary worktrees are created. Leave empty to create them one level up from the current repository. |
| ⚙️ [`git-smart-checkout.prBranchPrefix`](vscode://settings/git-smart-checkout.prBranchPrefix) (PR branch prefix) | `string` | Prefix added to PR clone branch names. If the prefix does not end with a slash, one is added automatically. |
| ⚙️ [`git-smart-checkout.showStatusBar`](vscode://settings/git-smart-checkout.showStatusBar) (Show status bar) | `boolean` | Shows the extension status bar item. |
| ⚙️ [`git-smart-checkout.useInPlaceCherryPick`](vscode://settings/git-smart-checkout.useInPlaceCherryPick) (Use in-place cherry-pick) | `boolean` | Uses in-place cherry-pick instead of a temporary worktree for PR cloning. This works best when cherry-pick conflicts are not expected. |
| ⚙️ [`git-smart-checkout.pullAfterCheckout`](vscode://settings/git-smart-checkout.pullAfterCheckout) (Pull after checkout) | `string` | Controls whether checking out a branch with an upstream also pulls it. Available values: `off` (never pull), `ffOnly` (default; fast-forward only via `git pull --ff-only`, never creates a merge commit — shows a warning instead of failing the checkout if a fast-forward isn't possible), `pull` (full pull, may create a merge commit). |
| ⚙️ [`git-smart-checkout.preferredRefs`](vscode://settings/git-smart-checkout.preferredRefs) (Preferred refs) | `object` | Per-user map of preferred refs by repository. Keys are `<owner>/<repo>` or workspace folder names; values contain `locals`, `remotes`, and `tags` arrays with full ref names. |
| ⚙️ [`git-smart-checkout.tagTemplate`](vscode://settings/git-smart-checkout.tagTemplate) (Tag template) | `string` | Template used to generate Git tag names. Supports `{f:<file>:<json-path>}`, `{b:<regex>}`, `{r:<start-number>}`, `{s:<script>}`, and `{s:stderr:<script>}` tokens. |
| ⚙️ [`git-smart-checkout.branchTemplate`](vscode://settings/git-smart-checkout.branchTemplate) (Branch template) | `string` | Template for **Create Branch from Template ...**. Supports `{jira-key}`, `{jira-title[:limit[:separator]]}`, `{f:...}`, `{b:...}`, `{r:...}`, `{s:...}`. Example: `vradchuk/{jira-key}-{jira-title:25:-}-{r:1}`. |
| ⚙️ [`git-smart-checkout.jira.domain`](vscode://settings/git-smart-checkout.jira.domain) (Jira domain) | `string` | Jira Cloud host (e.g. `your-company.atlassian.net`). Required when the branch template uses Jira tokens. |
| ⚙️ [`git-smart-checkout.jira.username`](vscode://settings/git-smart-checkout.jira.username) (Jira username) | `string` | Atlassian account username for Jira API authentication (usually your Atlassian account email). |
| ⚙️ [`git-smart-checkout.jira.email`](vscode://settings/git-smart-checkout.jira.email) (Deprecated Jira email) | `string` | Deprecated compatibility fallback used only when `jira.username` is empty. Migrate to `git-smart-checkout.jira.username`. |
| ⚙️ [`git-smart-checkout.jira.token`](vscode://settings/git-smart-checkout.jira.token) (Jira API token) | `string` | **Deprecated — stored in plaintext.** Use the `GSC: Set Jira Token...` command, which keeps the token in VS Code Secret Storage. Any value set here is migrated into Secret Storage and cleared on the next activation. |
| ⚙️ [`git-smart-checkout.jira.projectKeys`](vscode://settings/git-smart-checkout.jira.projectKeys) (Jira project keys) | `array` | Optional list of project keys that limit the Jira issue picker, e.g. `["KEY", "HOME"]`. Empty (default) shows all issues assigned to you. |
| ⚙️ [`git-smart-checkout.pushTagWithoutConfirmation`](vscode://settings/git-smart-checkout.pushTagWithoutConfirmation) (Push tag without confirmation) | `boolean` | Pushes the created Git tag to the remote without asking for confirmation. |
| ⚙️ [`git-smart-checkout.tagRemote`](vscode://settings/git-smart-checkout.tagRemote) (Tag remote) | `string` | Git remote used when pushing created tags. |
| ⚙️ [`git-smart-checkout.telemetry.enabled`](vscode://settings/git-smart-checkout.telemetry.enabled) (Telemetry enabled) | `boolean` | Enables anonymous Git Smart Checkout analytics while respecting VS Code's global telemetry settings. |

## Telemetry

This extension collects anonymous usage events to help improve the extension.

**Collected:**

- Extension activation
- Command usage (checkout, pull, rebase, tag creation, PR clone)
- Opening the status bar quick-actions menu
- Stash mode used during checkout and rebase commands
- Auto-stash manager action, changed file count, and whether the worktree already had changes
- Whether the working directory had uncommitted changes (boolean)
- Whether copy/move worktree commands copied staged/WIP changes, whether the target had local changes, included untracked files, and how many untracked files were copied
- Whether PR review worktree removal stashed changes before removal
- Number of worktrees removed in a bulk removal and whether their changes were stashed or reset
- Commit count for PR clone operations (number only)
- Whether a PR was created as a draft (boolean)
- Whether a tag template was used (boolean)
- Non-sensitive error type names (for example, `TypeError` or `Error`)
- VS Code version
- Extension version
- Operating system (platform, for example, `darwin`, `win32`, or `linux`)

**Not collected:**

- Source code
- File contents
- File paths
- Repository names
- Branch names
- Tag names
- Commit messages
- PR numbers or titles
- Remote URLs
- Personal information

Telemetry respects VS Code's global telemetry setting and can be disabled with:

```json
"telemetry.telemetryLevel": "off"
```

You can also disable extension telemetry independently with:

```json
"git-smart-checkout.telemetry.enabled": false
```
