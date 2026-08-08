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
- `StackStore` — Memento wrapper over `context.workspaceState`; now scoped to the local-ancestry **fallback** path only (`{ branch, parent, source: 'heuristic' | 'manual' }`), plus manual overrides (`mergeStackEntries`). PR-derived stacks are never persisted as edges here — see `prStack`/`stackModel` below
- `stackDetectionService` — the local ancestry heuristic (`computeLocalAncestryParents`, `detectLocalAncestryStacks` via `git merge-base --is-ancestor` / `git rev-list --count`, `heuristicEntriesFrom`). Offline-only; consulted by `StackService` solely as a fallback, never merged with GitHub stack data
- `stackTopology` — pure forest/tree helpers (`buildStackForest`, `topoOrder`, `findStackContaining`) used by the heuristic fallback path
- `prStack` — pure helpers over GitHub's native Stacks API (`GET /repos/{owner}/{repo}/stacks`, https://docs.github.com/en/rest/pulls/stacks): `findGithubStackForBranch(stacks, currentBranch)` locates the stack containing a branch (as target or as a stacked PR's head), `prStackFromGithubStack(stack, prs, currentBranch, resolveUrl)` builds the `PrStack` view-model input, enriching each GitHub-ordered stack member with title/url from the already-fetched open-PR list (falling back to a placeholder for a member with no matching open PR). No local head/base-ref walking — order, target, and stack membership all come straight from GitHub
- `stackModel` — the `StackView` shape both the Stacks webview and the status bar render (`stackViewFromPrStack` / `stackViewFromForest`, `indicatorBranchesOf`, `stackInfoMapOf`)
- `PrStackCache` — Memento-backed cache of the raw open-PR list per repository (TTL-based `isPrCacheFresh`), so a refresh fetches PRs at most once and a stale/offline fetch can still render from the last known list
- `StackService` — orchestrates a refresh: GitHub's Stacks API is authoritative; fetches the open-PR list once (`GitHubClient.listOpenPullRequestsOrThrow`, for title/url enrichment, cached) and the stack list once (`GitHubClient.listPullRequestStacksOrThrow`, uncached — a failure here means "no stack found," not "GitHub is unusable," since the PR-list call already proved auth/repo access works); the heuristic only runs when the open-PR list itself is genuinely unusable (no remote, or that call failed with no fresh cache) — the two sources are structurally never merged into one view

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

## Stacks View & Status Bar Indicator

`StackWebViewProvider` (`src/view/`, view id `git-smart-checkout.stacks`, same activity-bar container as Worktrees) renders **only the stack containing the current branch** — data is pushed in via `setStack(view)`, the provider itself has no git/GitHub access. Detection is driven externally from `extension.ts` (`refreshStacks`, debounced on git state/config changes) via `StackService.refresh()`, which fetches the open-PR list **once** per refresh (shared by the webview and the status bar), unlike the tree-view era which fetched per branch.

`StatusBarManager` owns a second status bar item (priority = mode item's priority + 1, so it renders immediately to its left) showing `$(layers) <position>/<size>` for the current branch's stack (`<size>` counts stacked PRs/branches only — the target is excluded, so sitting on the target itself shows no position), gated by `shouldShowStackIndicator` (pure, unit-tested) — hidden when stacks are disabled, the status bar is off, HEAD is detached (`isDetached` is a real signal from `StackService`, not derived from data presence), or the branch isn't stacked.

## WebView Integration

Three React-based webviews in `src/view/` (providers) + `src/webview/Apps/` (React roots):

- **PR Clone** (`PrCloneWebViewProvider` → `Apps/PR/`) — form: target branch, feature branch name, description with Markdown preview, Create/Cancel
- **PR Commits** (`PrCommitsWebViewProvider` → `Apps/Commits/`) — commit list with per-commit selection for cherry-pick
- **Stacks** (`StackWebViewProvider` → `Apps/Stacks/`) — the current branch's PR stack (`StackList`/`StackRow`/`StackTargetChip`/`ContextMenu` components); click a row to check it out via `git-smart-checkout.checkoutBranch` (argument-only, not palette-visible — reuses `AutoStashService` through the shared `checkoutRefWithStash` tail), right-click for "Open PR in Browser". The target chip additionally shows a read-only `⇡N ⇣N` ahead/behind indicator (`StackView.targetAheadBehind`, sourced from `%(upstream:track)` the same way `WorktreeTreeDataProvider` does) and a "Fetch latest changes" icon button that runs `git-smart-checkout.fetchBranch` (argument-only; `GitExecutor.fetchSpecificBranch`) then re-refreshes

`src/view/webviewHtml.ts` (`buildWebviewHtml`) is the single place that rewrites a built webview's HTML for use in a `WebviewView`: asset URIs, script nonce, and CSP injection — shared by all three providers. Webpack builds separate bundles (`main.js`, `commits.js`, `stacks.js`) via `webpack.webview.config.js`. WebView↔extension communication uses `postMessage` / `onDidReceiveMessage`. VS Code CSS variables handle theming.

### Markdown Preview

`src/webview/utils/renderMarkdown.ts` renders GFM via `markdown-it` + `markdown-it-task-lists`. Output is sanitized by DOMPurify in `sanitizeHtml.ts` before `dangerouslySetInnerHTML`. CSS lives in `MarkdownPreview/module.css`; renderer-generated class names (e.g. `task-list-item`) need `:global(...)` selectors.

## Analytics (`src/analytics/analytics.ts`)

PostHog, gated by `vscode.env.isTelemetryEnabled && config.telemetry.enabled`. Use `capture(AnalyticsEvent.Foo)` for events, `captureException` for errors. Tests set `GSC_DISABLE_TELEMETRY=1` to suppress.

## Configuration Changes

New settings require changes in two places: `package.json` `contributes.configuration` **and** the `ExtensionConfig` interface in `src/configuration/extensionConfig.ts`.

## Build System

esbuild bundles `src/extension.ts` → `dist/extension.js` (CJS, VS Code external). Webview uses webpack. Type-check with `yarn check-types` (extension) and `yarn check-types-webview` (webview) — they use separate `tsconfig.json` files.
