# git-smart-checkout

 Website https://git-smart-checkout.vradchuk.info

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![VS Marketplace](https://vsmarketplacebadges.dev/downloads/vradchuk.git-smart-checkout.png)](https://marketplace.visualstudio.com/items?itemName=vradchuk.git-smart-checkout)  [![Open VSX](https://img.shields.io/open-vsx/dt/vradchuk/git-smart-checkout?style=flat&logo=eclipseide)](https://open-vsx.org/extension/vradchuk/git-smart-checkout)

## Requirements

- Git **2.38** or newer (required for conflict pre-flight detection in *Auto stash and pop/apply* modes)

## Info

`git-smart-checkout` is a vscode extension that adds a new command `Git: Checkout to ... (With stash)` to command palette that allows to choose stash strategy at checkout.

Comments and contributions are very welcome!

## Motivation

In fast-paced development environments, switching between Git branches is a frequent but often disruptive task. Developers may have uncommitted changes that block a checkout, leading to tedious manual stashing and the risk of losing or misplacing changes. This common friction interrupts focus, breaks workflow, and slows down productivity.

The `git-smart-checkout` VSCode extension was created to eliminate that pain. It provides a seamless way to automatically stash and restore changes when switching branches—so developers can stay in the flow, move confidently between tasks, and trust that their work is safe.

Our goal is simple: make Git smarter, so you don’t have to think about it. `git-smart-checkout` reduces context-switching overhead and gives developers back valuable time and mental clarity. No more “local changes would be overwritten” errors—just smooth, uninterrupted development.

## Checkout modes

Command: `Git: Checkout to... (With Stash)`  

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

Command:  `Git: Pull (With Stash)`  

The extension provides a convenient **Pull with stash** feature. When you run this command, your uncommitted changes are automatically stashed before pulling updates from the remote branch. After the pull completes, your changes are restored. This ensures a smooth workflow and prevents conflicts or loss of local changes during a pull operation.

## Checkout ot previous branch with stash

Command: `Git: Checkout previous branch (With Stash)`  

This command switches workdir to previously checked branch, similar to command `git checkout -` with autostash using selected autostash mode or offers user to select autostash mode manually.

## GitHub PR Clone (BETA)

Command: `GitHub: Clone pull request...`  

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

1. **Initiate PR Clone**: Use the `GitHub: Clone pull request...` command from the command palette
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
   - **Cancel**: Abort the entire process and restore original state
6. **PR Creation**: Once all commits are processed, the extension automatically creates a new GitHub pull request or draft

The entire process is tracked with progress indicators and can be safely cancelled at any point, ensuring your workspace is restored to its original state.

## Create Tag from Template

Command: `Git: Create Git Tag from Template`

Generate Git tags from a configurable template, with safe token substitution for file values, branch regex matches, and auto-incrementing suffixes — so you never need to look up the current version or ticket number manually.

> [!TIP]
> Set `git-smart-checkout.tagTemplate` once per project and run `Create Git Tag from Template` from the command palette to produce a correct, collision-free tag in one step.

### Settings

| Setting | Default | Description |
| --- | --- | --- |
| `git-smart-checkout.tagTemplate` | `""` | Template string. Leave empty to enter tag name manually. |
| `git-smart-checkout.pushTagWithoutConfirmation` | `false` | Push the created tag automatically without asking. |
| `git-smart-checkout.tagRemote` | `"origin"` | Remote to push tags to. |

### Template tokens

| Token | Example | Description |
| --- | --- | --- |
| `{f:<file>:<json-path>}` | `{f:package.json:.version}` | Reads a JSON value from a workspace-local file. |
| `{b:<regex>}` | `{b:\b[A-Z]+-\d{3,4}\b}` | Extracts the first regex match from the current branch name. |
| `{r:<N>}` | `{r:1}` | Auto-increments from N until the resulting tag name does not exist. |
| `{s:<script>}` or `{s:stdout\|stderr:<script>}` | `{s:./get-build-id.sh}` | Runs a workspace-local script and uses its output. Defaults to `stdout`; specify `stderr` to capture the error stream instead. Tag generation stops if the script fails. |

### Example

With template:

```text
mobile-v{f:package.json:.version}-{b:\b[A-Z]+-\d{3,4}\b}-{r:1}
```

On branch `feature/FEAT-123-login` with `package.json` version `12.3.4` and existing tags `mobile-v12.3.4-FEAT-123-1` and `mobile-v12.3.4-FEAT-123-2`, the command generates:

```text
mobile-v12.3.4-FEAT-123-3
```

### Manual tag entry

If `git-smart-checkout.tagTemplate` is empty, the command prompts for a tag name. The input is validated and checked for uniqueness before creation.

### Security

File paths in `{f:...}` tokens are restricted to the workspace root — absolute paths, `..` traversal, and symlink escapes are all rejected. Tag names are validated against shell-unsafe characters and `git check-ref-format` rules before any git command is run.

## Telemetry

This extension collects anonymous usage events to help improve the extension.

**Collected:**
- Extension activation
- Command usage (checkout, pull, tag creation, PR clone)
- Stash mode used during checkout
- Whether the working directory had uncommitted changes (boolean)
- Commit count for PR clone operations (number only)
- Whether a PR was created as a draft (boolean)
- Whether a tag template was used (boolean)
- Non-sensitive error type names (e.g. `TypeError`, `Error`)
- VS Code version
- Extension version
- Operating system (platform, e.g. `darwin`, `win32`, `linux`)

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
