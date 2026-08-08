# Code Architecture

## Extension Structure

VS Code extension providing intelligent Git checkout with automatic stashing. Entry point: `src/extension.ts`.

**Core singletons (wired in `activate`):**
- `CommandManager` — registers commands, wraps each in consistent error handling
- `ConfigurationManager` — reads/watches `vscode.workspace.getConfiguration`, exposes typed `ExtensionConfig`
- `StatusBarManager` — status bar item showing active stash mode
- `LoggingService` — output channel wrapper, gated by config

## Command Pattern

All commands extend `BaseCommand` (implements `ICommand`) and live in `src/commands/<name>Command/`. Register new commands in `extension.ts` via `CommandManager`. The `ICommand` interface requires `execute(...args)` and optionally `getPromptOptions()` / `validateInput()`.

## Services Layer (`src/services/`)

Business logic decoupled from VS Code UI:

- `AutoStashService` — resolves active stash mode (from config or QuickPick prompt), then runs stash/pop/apply via `GitExecutor`
- `PrCloneService` — orchestrates PR cloning; delegates to one of two strategies controlled by `useInPlaceCherryPick` config:
  - `PrCloneInPlaceService` — cherry-picks into the current working tree
  - `PrCloneTempWorktreeService` — cherry-picks into a temporary git worktree, then moves it
- `BranchTemplateService` / `TagTemplateService` — interpolate `{jira}`, `{branch}`, `{tag}` placeholders using Jira metadata and git refs
- `JiraService` — fetches Jira issue data via REST API using stored token
- `RefDetailsCache` — caches ref→commit lookups to avoid redundant git calls
- `PRReviewWorktreeStore` — persists active PR-review worktree paths across sessions
- `StackStore` — Memento wrapper over `context.workspaceState` persisting the detected stack forest (`{ branch, parent, source }`); manual entries always win over `github`/`heuristic` detection on merge (`mergeStackEntries`)
- `stackDetectionService` — detects chains of dependent branches ("stacks") from two sources, merged: GitHub PR base chains (authoritative, via `GitHubClient.listOpenPullRequests`) and a local ancestry heuristic (`git merge-base --is-ancestor` / `git rev-list --count`, offline fallback). Pure functions (`computeLocalAncestryParents`, `computeGithubParents`, `mergeDetectedParents`) are unit-tested against fixtures; `detectStacks` is the async orchestrator
- `stackTopology` — pure forest/tree helpers (`buildStackForest`, `topoOrder`, `findStackContaining`) shared by `StackTreeDataProvider` and the status bar indicator

## Git Integration (`src/common/git/`)

Two distinct abstractions — don't conflate them:

- `VscodeGitProvider` — wraps the built-in `vscode.git` extension API (no child processes); use for **reads** (list refs, stashes, worktrees, commits)
- `GitExecutor` — runs `git` via `child_process.execFile`; use for **mutations** and anything not in the VS Code API

`getGitExecutor()` in `src/utils/` resolves the right `GitExecutor` instance for the active repository (multi-root aware via `VscodeGitProvider`).

## Stash Modes (config: `mode`)

| Config value | Behavior |
|---|---|
| `manual` | QuickPick prompt on each operation |
| `autoStashForBranch` | Stash stays on originating branch |
| `autoStashAndPop` | Stash is popped onto target branch (destructive) |
| `autoStashAndApply` | Stash applied to target branch, original preserved |

## Stacks Tree View & Status Bar Indicator

`StackTreeDataProvider` (`src/view/`, view id `git-smart-checkout.stacks`, same activity-bar container as Worktrees) follows the two-phase render pattern from `WorktreeTreeDataProvider`: fast phase 1 builds the forest topology from `StackStore` alone, phase 2 asynchronously enriches each branch with PR number/state, ahead/behind vs. parent, and a needs-restack flag (`NOT git merge-base --is-ancestor <parent-tip> <branch-tip>`). Detection itself is driven externally from `extension.ts` (`refreshStacks`, debounced on git state/config changes), not by the provider.

`StatusBarManager` owns a second status bar item (priority = mode item's priority + 1, so it renders immediately to its left) showing `$(layers) <position>/<size>` for the current branch's stack, gated by `shouldShowStackIndicator` (pure, unit-tested) — hidden when stacks are disabled, the status bar is off, HEAD is detached, or the branch isn't stacked.

## WebView Integration

Two React-based webviews in `src/view/` (providers) + `src/webview/Apps/` (React roots):

- **PR Clone** (`PrCloneWebViewProvider` → `Apps/PR/`) — form: target branch, feature branch name, description with Markdown preview, Create/Cancel
- **PR Commits** (`PrCommitsWebViewProvider` → `Apps/Commits/`) — commit list with per-commit selection for cherry-pick

Webpack builds separate bundles (`main.js`, `commits.js`) via `webpack.webview.config.js`. WebView↔extension communication uses `postMessage` / `onDidReceiveMessage`. VS Code CSS variables handle theming.

### Markdown Preview

`src/webview/utils/renderMarkdown.ts` renders GFM via `markdown-it` + `markdown-it-task-lists`. Output is sanitized by DOMPurify in `sanitizeHtml.ts` before `dangerouslySetInnerHTML`. CSS lives in `MarkdownPreview/module.css`; renderer-generated class names (e.g. `task-list-item`) need `:global(...)` selectors.

## Analytics (`src/analytics/analytics.ts`)

PostHog, gated by `vscode.env.isTelemetryEnabled && config.telemetry.enabled`. Use `capture(AnalyticsEvent.Foo)` for events, `captureException` for errors. Tests set `GSC_DISABLE_TELEMETRY=1` to suppress.

## Configuration Changes

New settings require changes in two places: `package.json` `contributes.configuration` **and** the `ExtensionConfig` interface in `src/configuration/extensionConfig.ts`.

## Build System

esbuild bundles `src/extension.ts` → `dist/extension.js` (CJS, VS Code external). Webview uses webpack. Type-check with `yarn check-types` (extension) and `yarn check-types-webview` (webview) — they use separate `tsconfig.json` files.
