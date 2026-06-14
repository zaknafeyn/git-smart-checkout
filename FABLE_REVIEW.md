# Git Smart Checkout — Code Review (FABLE_REVIEW)

Review date: 2026-06-12. Scope: full `src/` tree (extension host code, services, git layer, webviews) plus `package.json` contributions. All line numbers refer to the current `main` working tree.

Each issue includes: what is wrong, where to find it, how to reproduce it, and a fix description detailed enough to hand to an AI agent for implementation.

Severity legend: 🔴 critical (data loss / feature broken), 🟠 high (feature partially broken or wrong results), 🟡 medium/minor (UX, correctness edge cases, hygiene).

---

## 1. 🔴 Cancelling a PR clone in temp-worktree mode hard-resets the user's main repository (data loss)

**Where:**
- `src/services/prCloneService.ts:123-125` — `abortClonePR()` unconditionally calls `this.InPlaceService.abortClonePR()`, ignoring the `useInPlaceCherryPick` setting.
- `src/services/prCloneInPlaceService.ts:135-186` — `cleanUp()` runs `await this.git.reset(true)` (i.e. `git reset --hard`) **before** the `if (!this.serviceStore.originalBranch) return;` guard.

**The problem:** When `git-smart-checkout.useInPlaceCherryPick` is `false`, the clone runs in `PrCloneTempWorktreeService`, but the `prCancelCloneMenu` command (`extension.ts:271-276`) still routes to `InPlaceService.abortClonePR()`. That calls `InPlaceService.cleanUp(true)` whose `serviceStore` is empty — but the hard reset at `prCloneInPlaceService.ts:152-156` executes anyway, against `this.git`, which is the **user's main repository**. Any uncommitted changes in the user's working directory are destroyed. The in-place service was never used, so there is no stash to recover from.

**How to reproduce:**
1. Set `"git-smart-checkout.useInPlaceCherryPick": false`.
2. Make uncommitted edits in the repo.
3. Run `Clone pull request...`, fetch a PR, start cloning.
4. While the clone is in progress (view title menu shows Cancel when `isCloning && isConflict`), invoke `git-smart-checkout.prCancelCloneMenu` (or call `prCloneService.abortClonePR()` from any path).
5. Observe `git reset --hard` is executed in the main repo; uncommitted changes are gone.

**How to fix:**
1. In `PrCloneService.abortClonePR()` (`src/services/prCloneService.ts:123`), dispatch on configuration exactly like `clonePR()` and `cherryPickNext()` do:
   ```ts
   async abortClonePR() {
     const config = this.configurationManager.get();
     if (config.useInPlaceCherryPick) {
       this.InPlaceService.abortClonePR();
     } else {
       this.TempWorktreeService.abortClonePR();
     }
   }
   ```
   `PrCloneTempWorktreeService` inherits `abortClonePR()` from `PrCloneServiceBase` (`cancelProgress?.()` + `cleanUp(true)`), and its `cleanUp()` only runs registered actions — safe.
2. In `PrCloneInPlaceService.cleanUp()` (`src/services/prCloneInPlaceService.ts:135`), make the destructive steps conditional on a clone actually having started: move the `if (!this.serviceStore.originalBranch) { return; }` guard **above** the `isCherryPickInProgress`/`reset(true)` block, so an un-started service never resets anything. Additionally, prefer `git reset --hard` only when `serviceStore.createdBranchName` is set (i.e. we are on the temporary branch the service itself created).
3. Add a unit/e2e test: configure temp-worktree mode, dirty the workdir, call `abortClonePR()`, assert workdir changes survive.

---

## 2. 🔴 Checking out a tag from "Checkout to..." always fails

**Where:** `src/commands/checkoutToCommand/index.ts:293-317` (`getTargetBranch`), icon list at line 298: `const iconsToRemove = [ICON_BRANCH, ICON_REMOTE_BRANCH];`.

**The problem:** The quick pick includes a "Tags" section (`buildItems`, lines 185-186). When a ref is picked, `getSelectedOption` returns `selection = getRefLabel(picked.ref)` (line 288), which for tags is `"$(tag) v1.2.3"` (see `getRefIcon` in `src/commands/utils/refFormatting.ts`). `getTargetBranch` strips only `ICON_BRANCH` and `ICON_REMOTE_BRANCH` from the label, so for tags the lookup `branchList.find((ref) => ref.fullName === branchName)` runs with `branchName === "$(tag) v1.2.3"`, finds nothing, and throws `Cannot find appropriate object for a ref $(tag) v1.2.3`.

**How to reproduce:** In a repo with at least one tag, run `Checkout to... (With Stash)`, scroll to the Tags section, select a tag → error notification "Cannot find appropriate object for a ref $(tag) <tagname>".

**How to fix (preferred, structural):** Stop round-tripping the selection through a display string. In `getSelectedOption`, the accepted item already carries the full `IGitRef` (`picked.ref`). Change the return type of `getSelectedOption` to return `{ currentBranch, selection: string, selectedRef?: IGitRef, branchList }`, set `selectedRef = picked.ref` for `kind === 'ref'`, and in `execute()` pass `selectedRef` directly to `checkoutAndStashChanges` when present, calling `getTargetBranch` only for the two "Create new branch" actions. Delete the icon-stripping `reduce`.
**Minimal fix (if keeping the string flow):** add `ICON_TAG` to `iconsToRemove` and import it from `../utils/refFormatting`. Note the structural fix also removes a latent ambiguity where a local branch and a tag with the same `fullName` would resolve to whichever appears first in `branchList`.
Add an e2e test in `src/test/e2e/checkout.test.ts` covering tag selection.

---

## 3. 🔴 PR clone silently drops commits on PRs with more than 30 commits (no GitHub pagination)

**Where:** `src/common/api/ghClient.ts:131-134` (`fetchPullRequestCommits`), also `fetchLabels` (lines 237-240).

**The problem:** `GET /repos/{owner}/{repo}/pulls/{n}/commits` returns 30 items per page by default. `makeRequest` performs a single request with no `per_page` and no `Link`-header pagination. For PRs with >30 commits the commits webview shows only the first 30, and the clone cherry-picks an incomplete set — silently producing a wrong PR. Same truncation applies to `fetchLabels` for repos with >30 labels.

**How to reproduce:** Run `Clone pull request...` against a PR that has 31+ commits. The "Commits to Cherry-pick" view lists exactly 30; the cloned branch is missing the rest.

**How to fix:**
1. Add a generic paginated GET to `GitHubClient`:
   ```ts
   private async makePaginatedRequest<T>(endpoint: string): Promise<T[]> {
     const results: T[] = [];
     let page = 1;
     const perPage = 100;
     while (true) {
       const sep = endpoint.includes('?') ? '&' : '?';
       const batch = await this.makeRequest<T[]>(`${endpoint}${sep}per_page=${perPage}&page=${page}`);
       results.push(...batch);
       if (batch.length < perPage) break;
       page++;
     }
     return results;
   }
   ```
2. Use it in `fetchPullRequestCommits` and `fetchLabels`.
3. The pulls/commits endpoint caps at 250 commits; when `prData.commits > 250` (the PR object has a `commits` count field), surface a warning notification telling the user the PR is too large to clone fully.
4. Unit-test with a mocked `makeRequest` returning 100/100/12 items across three calls.

---

## 4. 🔴 `isCherryPickInProgress()` can never return true — abort/cleanup leaves the repo mid-cherry-pick

**Where:** `src/common/git/gitExecutor.ts:548-555`.

**The problem:** The method greps `git status --porcelain=v1` output for the text `"You are currently cherry-picking"`. That sentence only appears in *human-readable* `git status`; porcelain v1 output is strictly `XY <path>` lines. The method therefore always returns `false`. Consequence: `PrCloneInPlaceService.cleanUp()` (`prCloneInPlaceService.ts:142-149`) never runs `cherryPickAbort()`, so aborting a clone during a conflict leaves `CHERRY_PICK_HEAD` behind; the subsequent `reset --hard` + `checkout` then operate in a half-finished cherry-pick state, and the next cherry-pick/commit in that repo behaves unexpectedly (e.g. `git commit` completes the stale cherry-pick).

**How to reproduce:** Start an in-place PR clone that hits a conflict; click Cancel. Run `git status` in the repo — it still reports "You are currently cherry-picking commit …" (or `.git/CHERRY_PICK_HEAD` exists).

**How to fix:** Replace the text sniffing with a ref check:
```ts
async isCherryPickInProgress(): Promise<boolean> {
  try {
    await this.#execGitCommand(['rev-parse', '-q', '--verify', 'CHERRY_PICK_HEAD']);
    return true;
  } catch {
    return false;
  }
}
```
(Equivalently, check `fs.existsSync(path.join(gitDir, 'CHERRY_PICK_HEAD'))` after resolving `git rev-parse --git-dir`; the `rev-parse --verify` form needs no fs access and works in worktrees.) Add a unit test using a fixture repo: start a conflicting cherry-pick, assert `true`; after `cherry-pick --abort`, assert `false`.

---

## 5. 🟠 Remote-branch existence checks query a non-existent ref (`refs/remotes/<branch>` without remote name)

**Where:** `src/common/git/gitExecutor.ts:136-148` (`#checkRemoteBranchExists`, default `includeRemoteName = false`), callers at line 187 (`checkout`) and line 615 (`branchExist`).

**The problem:** With the default `includeRemoteName = false`, the verified ref is `refs/remotes/<branchName>` — e.g. `refs/remotes/feature-x` — which never exists (real refs are `refs/remotes/origin/feature-x`). Both production callers use the default, so:
- `checkout()` (line 184): the "create local tracking branch from remote" path (`checkout -b <name> origin/<name>`) is dead code. The fallback plain `git checkout <name>` only works via git's DWIM, which **fails when the branch exists on more than one remote** ("'<name>' matched multiple remote tracking branches").
- `branchExist()` / `createUniqueFeatureBranch()` (line 170): uniqueness check misses remote-only branches, so PR clone can pick a feature-branch name that already exists on `origin`, and the later `git push -u origin <name>` fails with a non-fast-forward error.

**How to reproduce:** Add a second remote (`git remote add upstream …; git fetch upstream`). Ensure branch `feat` exists on both remotes but not locally. Run `Checkout to...` and pick the remote `feat` → checkout fails with the DWIM ambiguity error. For the second symptom: delete local branch `foo` but keep `origin/foo`, then clone a PR with feature branch name `foo` → push step fails.

**How to fix:** Make `includeRemoteName` default to `true` (i.e. verify `refs/remotes/<remote>/<branch>`), and audit the two call sites:
- `checkout(branchName, remoteName)`: call `this.#checkRemoteBranchExists(branchName, true, remoteName)`.
- `branchExist(branchName)`: same.
Remove the now-unused `false` branch of the template string. Add unit coverage by extending `src/test/e2e/checkout.test.ts` with a two-remote fixture (the helpers in `src/test/e2e/helpers/gitTestRepo.ts` can add a second remote).

---

## 6. 🟠 Ref list parsing breaks when a commit subject contains `|`

**Where:** `src/common/git/gitExecutor.ts:262-331` (`getAllRefListExtended`, `SEPARATOR = '|'`), same pattern in `createBranch` (lines 216-223).

**The problem:** The `for-each-ref` format joins fields with `|` and the parser does `line.split(SEPARATOR)`. Commit subjects routinely contain `|` (e.g. `feat: add a | b parser`). Every field after `%(subject)` then shifts: `upstreamTrack` receives a fragment of the subject, `#parseTrackData` produces garbage/NaN, and `authorName` is wrong. The branch picker shows corrupted descriptions for such refs.

**How to reproduce:** `git commit --allow-empty -m "test | pipe in subject"` on any branch, then run `Checkout to...` with `useFastBranchList: false` (or any path hitting `getAllRefListExtended`) — that branch's row shows wrong author/ahead-behind data.

**How to fix:** Use a character that cannot appear in the data as separator: `%00` is not supported in `--format` for `for-each-ref` field joining via printf-style, but you can use a control character literal, e.g. `const SEPARATOR = '\x1f'` (ASCII Unit Separator) and embed it directly in the format string (`%(refname)\x1f%(objectname:short)\x1f…`). git passes it through verbatim and it cannot occur in ref names, hashes, dates, or (practically) subjects; additionally cap the damage by using `split(SEPARATOR)` with a fixed field count. Apply the same change to the `for-each-ref` call in `createBranch`. Unit-test `getAllRefListExtended` against a fixture repo containing a `|` in a commit subject (e2e helpers already create repos).

---

## 7. 🟠 Ahead/behind parsing returns `NaN` when a branch is both ahead and behind

**Where:** `src/common/git/gitExecutor.ts:108-125` (`#parseTrackData`).

**The problem:** For `[ahead 3, behind 2]`, `slice(1, -1).split(',')` yields `['ahead 3', ' behind 2']`. The second element has a **leading space**, so `' behind 2'.split(' ')[1]` is `'behind'`, and `Number('behind')` is `NaN`. The branch picker description renders `↑3 ↓NaN`.

**How to reproduce:** Create a branch tracking origin with both local-only and remote-only commits (`git commit` locally; push a different commit from another clone; `git fetch`). Open `Checkout to...` with `useFastBranchList: false` and inspect the row description.

**How to fix:** Trim each piece before splitting:
```ts
const [ahead, behind] = arr.map((i) => Number(i.trim().split(' ')[1]));
```
Add unit tests for `#parseTrackData` (export it or test through `getAllRefListExtended`): inputs `[ahead 3, behind 2]` → `[3, 2]`, `[ahead 3]` → `[3, 0]`, `[behind 2]` → `[0, 2]`, `[gone]`/empty → `undefined`.

---

## 8. 🟠 `createWithProcess` returns progress handles that may be `undefined` — in-place clone progress can never finish

**Where:** `src/utils/createWithProcess.ts:3-38`; consumer `src/services/prCloneInPlaceService.ts:193-200`.

**The problem:** `finishProgress`, `cancelProgress`, and `updateProgress` are assigned *inside* the `window.withProgress` task callback, but the function returns immediately after calling `withProgress`. The code relies on VS Code invoking the task callback synchronously — an undocumented implementation detail. If the callback runs on a later tick, the returned destructured values are `undefined`. Every consumer optional-chains them (`this.finishProgress?.()`), so the failure mode is silent: the "Cloning PR…" notification never resolves and spins forever, and Cancel (`cancelProgress`) does nothing. Separately, `cancelProgress = reject` rejects a promise nobody catches → unhandled-rejection noise.

**How to reproduce:** Hard to force deterministically (depends on VS Code internals/version); the structural race is visible from the code. A stale "Cloning PR #N (In-Place)" notification that survives a finished clone is the field symptom.

**How to fix:** Return an object whose *methods* close over mutable slots instead of returning the slots' current values:
```ts
export const createWithProcess = (title: string, cleanUp?: (isAborting: boolean) => void) => {
  let resolveFn: (() => void) | undefined;
  let rejectFn: (() => void) | undefined;
  let progressRef: Progress<{ message?: string; increment?: number }> | undefined;
  const pending: { message?: string }[] = [];

  window.withProgress({ location: ProgressLocation.Notification, title, cancellable: true },
    (progress, token) => new Promise<void>((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
      progressRef = progress;
      pending.forEach((m) => progress.report(m));
      token.onCancellationRequested(() => { resolve(); cleanUp?.(true); });
    })
  ).then(undefined, () => { /* swallow cancellation rejection */ });

  return {
    finishProgress: () => resolveFn?.(),
    cancelProgress: () => resolveFn?.(),   // resolve, don't reject — avoids unhandled rejection
    updateProgress: { report: (m: { message?: string }) => progressRef ? progressRef.report(m) : pending.push(m) },
  };
};
```
Update `PrCloneInPlaceService` to the new shape (it already stores and optional-calls them, so changes are minimal). Also see Issue 9 — the progress should be explicitly finished on every error path.

---

## 9. 🟠 In-place `clonePR` swallows all errors; UI is left stuck in "cloning" state

**Where:** `src/services/prCloneInPlaceService.ts:271-273` (`catch (error) { captureException(error); }`); also `src/view/PrCloneWebViewProvider.ts:280-307` (`handleClonePR` sets `updateCloningState(true)` but never resets it on error) and `src/services/prCloneService.ts:101-111` (`setContextIsCloning(true)` with no error path back to `false`).

**The problem:** If anything in the in-place flow throws (checkout of target branch fails, branch creation fails, GitHub push/PR creation fails inside `cherryPickNext`'s done-branch — note `cherryPickNext` is called fire-and-forget at line 270 and `pushBranchToGitHub`/`createGitHubPR` failures there are completely unhandled), the user gets **no error message**, the `isCloning` context stays `true` (buttons stay disabled, Cancel menu logic misbehaves), the progress notification keeps spinning, and the repo may be left on the temporary feature branch with the user's changes still stashed.

**How to reproduce:** Configure in-place mode; clone a PR whose feature branch push will fail (e.g. revoke repo write access, or disconnect network after fetch). The progress spinner never ends, no error is shown, `git branch` shows you stranded on the new branch.

**How to fix:**
1. In `clonePR`'s `catch` (line 271): log, `captureException`, show `window.showErrorMessage('Failed to clone PR: …')`, call `this.cancelProgress?.()` and `await this.cleanUp(true)` so the original branch/stash are restored and `isCloning` context resets.
2. `cherryPickNext` (line 56-93): wrap the done-branch (`pushBranchToGitHub` → `createGitHubPR`) in try/catch with the same recovery: error message + `cancelProgress` + `cleanUp(true)`.
3. In `clonePR` change `this.cherryPickNext();` to `await this.cherryPickNext();` (or `.catch(...)`) so its rejections are not unhandled.
4. In `PrCloneWebViewProvider.handleClonePR` catch block (line 301): add `this.updateCloningState(false)`.
5. In `PrCloneService.clonePR` (line 101): wrap the dispatch in try/finally — on throw, `setContextIsCloning(false)` and rethrow.

---

## 10. 🟠 "Fetch PR Data" spinner in the webview never stops when the fetch fails

**Where:** `src/view/PrCloneWebViewProvider.ts:127-167` (`handleFetchPR` error path), `src/webview/Apps/PR/pages/PrInputForm/index.tsx:60-70` (spinner started via `useLoadingState`, only cleared by `SHOW_PR_DATA` re-render or manual Cancel).

**The problem:** The webview sets its loading state and sends `FETCH_PR`. On failure (bad PR number, network error, auth declined), the extension shows a notification but **never posts a message back to the webview**, so the "Fetch PR Data" button stays in its loading state until the user clicks Cancel.

**How to reproduce:** Run `Clone pull request...`, type `999999` (non-existent PR), submit. An error notification appears; the button spinner keeps spinning indefinitely.

**How to fix:**
1. Add a `FETCH_PR_ERROR` command to `src/types/webviewCommands.ts` (and the mirrored webview enum in `src/webview/types/commands`).
2. In `handleFetchPR`'s catch block, post it: `this.webviewView?.webview.postMessage({ command: WebviewCommand.FETCH_PR_ERROR, message: String(error) });`
3. In `PrInputForm`, lift the loading state to `App` (or pass a `fetchFailed` prop): handle `FETCH_PR_ERROR` in the `App` message listener and reset the loading flag. Simplest concrete change: move `useLoadingState` into `App/index.tsx`, pass `isLoading` + `onSubmit` down to `PrInputForm`, and clear it on both `SHOW_PR_DATA` and `FETCH_PR_ERROR`.

---

## 11. 🟠 Labels and assignees are silently dropped when re-creating the PR

**Where:** `src/common/api/ghClient.ts:205-232` (`createPullRequest`), consumer `src/services/prCloneInPlaceService.ts:281-307`.

**The problem:** The GitHub `POST /repos/{owner}/{repo}/pulls` endpoint does not accept `labels` or `assignees` fields — they are ignored server-side. The in-place flow extracts labels/assignees from the original PR and passes them in the body, but the created PR never has them. (The temp-worktree flow doesn't even try.)

**How to reproduce:** Clone a PR that has labels and assignees (in-place mode). Open the created PR on GitHub: no labels, no assignees.

**How to fix:** After creating the PR, issue follow-up calls against the Issues API (PRs are issues):
```ts
if (labels?.length)    await this.makeRequest(`/repos/${this.owner}/${this.repo}/issues/${newPr.number}/labels`, 'POST', { labels });
if (assignees?.length) await this.makeRequest(`/repos/${this.owner}/${this.repo}/issues/${newPr.number}/assignees`, 'POST', { assignees });
```
Do this inside `createPullRequest` (keeping its signature), wrap each in try/catch and log a warning on failure rather than failing the whole clone. Also pass labels/assignees from `PrCloneTempWorktreeService.createGitHubPR` for parity.

---

## 12. 🟠 `popStash` truncates stash messages containing `": "` — inconsistent with `isStashWithMessageExists`

**Where:** `src/common/git/gitExecutor.ts:346-373` (`popStash`, `message.split(': ')[1]`), compare `isStashWithMessageExists` at lines 442-458 which correctly uses `parts.slice(1).join(': ')`.

**The problem:** `git stash list --format=%gs` prints `On <branch>: <message>`. `popStash` keeps only `split(': ')[1]`, so any stash message containing `": "` is truncated and `findIndex` fails → `Error('No stash found')`. The paired existence check uses the correct `slice(1).join(': ')`, so the flow in `AutoStashService.doAutoStashAndPopInNewBranch` (`autoStashService.ts:332-339`) confirms the stash exists and then fails to pop it, leaving the user's changes stranded in the stash with an error notification. Auto-generated messages are currently safe (no `": "`), but any future format change or manual stash with that substring triggers it.

**How to reproduce:** `git stash push -m "auto-stash-main: extra"` then call `git.popStash('auto-stash-main: extra')` (or unit-test directly) → "No stash found" even though `isStashWithMessageExists` returns true.

**How to fix:** Extract one shared helper, e.g. in `gitExecutor.ts`:
```ts
const stripStashPrefix = (gs: string): string => {
  const idx = gs.indexOf(': ');
  return idx === -1 ? gs : gs.slice(idx + 2);
};
```
Use it in both `popStash` and `isStashWithMessageExists`. Also consider matching stashes by exact `%gs` equality with the known `On <branch>: ` prefix removed via `indexOf` (as above) rather than `split`. Add unit tests for messages containing `": "`.

---

## 13. 🟠 `getRepoInfo()` regex breaks for repository names containing dots

**Where:** `src/common/git/gitExecutor.ts:663-674`, regex `/github\.com[:/]([^/]+)\/([^/.]+)/`.

**The problem:** `[^/.]+` stops at the first `.`, so `github.com/vercel/next.js` parses repo as `next`, and `my.repo.name` parses as `my`. Every GitHub API call (`fetchPullRequest`, `createPullRequest`, …) then targets a non-existent repo, and `getRepoId` (used to key preferred refs) is wrong too.

**How to reproduce:** In a clone of any repo whose name contains a dot (e.g. `next.js`), run `Checkout by PR number...` → "GitHub API error: 404".

**How to fix:** Strip a trailing `.git` explicitly instead of excluding dots from the name:
```ts
const match = remoteUrl.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/);
if (match) return { owner: match[1], repo: match[2] };
```
Unit-test against: `git@github.com:owner/repo.git`, `https://github.com/owner/repo`, `https://github.com/owner/repo.git`, `https://github.com/owner/next.js`, `git@github.com:owner/my.repo.name.git`.

---

## 14. 🟠 `PrCloneService.init()` is one-shot — stale repo/GitHub client after switching repositories

**Where:** `src/services/prCloneService.ts:81-99` (`if (!this.isInited) { … }`), caller `src/extension.ts:213-238`.

**The problem:** `clonePullRequest` calls `getGitExecutor` (which, in multi-root workspaces, asks the user to pick a repo) and then `prCloneService.init(git, ghClient)`. Because `init` no-ops after the first call, picking a *different* repository the second time silently keeps the first repository's `GitExecutor` and `GitHubClient`: PRs are fetched from the wrong repo, branches are created in the wrong working tree. Same staleness occurs if the remote URL changes.

**How to reproduce:** Open a multi-root workspace with two GitHub repos. Run `Clone pull request...`, pick repo A, cancel. Run it again, pick repo B → the webview header still shows repo A's `owner/repo`, and fetched PRs come from repo A.

**How to fix:** Make `init` re-entrant. Replace the guard with: if already inited and `git.repositoryPath` and `ghClient.owner/repo` are identical, return; otherwise dispose the existing sub-services (`this._tempWorktreeService?.dispose(); this._inPlaceService?.dispose();`) and rebuild them with the new `git`/`ghClient`. The webview providers read `prCloneService.git`/`ghClient` at `resolveWebviewView` time (`PrCloneWebViewProvider.ts:42-43`) — change those reads to pull lazily from the service (use getters or read inside handlers) so they always see the current executor, and re-post `UPDATE_REPO_INFO` after re-init so an already-resolved webview updates its header.

---

## 15. 🟡 `git stash create`-based conflict preview ignores untracked files and misreads fatal errors

**Where:** `src/common/git/gitExecutor.ts:471-487` (`getStashConflictPreview`), consumers `autoStashService.ts:301` and `moveToNewWorktreeCommand/index.ts:230`.

**The problem:** Two parts:
1. `git stash create` only materializes **tracked** changes, while the stash that is later created uses `-u` (untracked included, `createStash` default). An untracked file in the workdir that exists with different content on the target branch will conflict at `stash pop` time but the preview reports "no conflicts". (Also, with *only* untracked changes, `stash create` outputs nothing and the preview short-circuits to `[]`.)
2. The `catch` branch treats **any** non-zero exit as "conflict list on stdout". On git < 2.38 (`merge-tree --write-tree` unsupported) or other fatal errors (exit 128/129) stdout is empty so it degrades to `[]` silently — acceptable — but a fatal error that does print to stdout would be parsed as conflict paths. The exit code is available on the error object (`execCommand` attaches it) and should be checked.

**How to fix:** In the `catch`, inspect `(e as ExecException).code`: only parse stdout when `code === 1`; for any other code, log a warning via `this.#logService` and return `[]` (preview unavailable). For untracked coverage, document the limitation in the method comment and in the confirm dialogs ("preview covers tracked files only"), or implement full coverage: build a temporary index (`GIT_INDEX_FILE` env) with `git add -A`, `git write-tree`, and use that tree for the merge-tree simulation instead of `stash create`.

---

## 16. 🟡 Stash message timestamps use 12-hour `hh` without AM/PM — non-unique messages

**Where:** `src/commands/utils/getStashMessage.ts:6` — `format(Date.now(), 'yyyy-MM-ddThh:mm:ss')`.

**The problem:** `hh` is the 12-hour clock in date-fns. Stashes created at 01:23:45 and 13:23:45 on the same day get identical messages. `popStash` matches by message, so the wrong (older) stash can be popped/applied in the pop/apply flows that key on dated messages.

**How to fix:** Change the format string to `'yyyy-MM-dd'T'HH:mm:ss'` (note `HH`, and quote the literal `T` — the current unquoted `T` only works by accident). Keep `AUTO_STASH_PREFIX` unchanged. Verify the e2e stash tests still pass.

---

## 17. 🟡 Status bar uses an unsupported ThemeColor for background

**Where:** `src/statusBar/statusBarManager.ts:44-49`.

**The problem:** `StatusBarItem.backgroundColor` only honors `statusBarItem.errorBackground` and `statusBarItem.warningBackground` (VS Code API restriction). The manual-mode branch sets `statusBarItem.descriptionForeground` — a *foreground* color id — which VS Code ignores. The code works only coincidentally (ignored value ≈ default background). Anyone changing these constants will be confused.

**How to fix:** In manual mode set `this.statusBarItem.backgroundColor = undefined;` explicitly; keep `new ThemeColor('statusBarItem.warningBackground')` for the auto modes. Also fix the double-space typo `'Select Auto Stash Checkout  Mode'` (line 72) and the same in the log message (line 80).

---

## 18. 🟡 Pasting a PR URL from a different repository fetches the wrong PR

**Where:** `src/view/PrCloneWebViewProvider.ts:169-181` (`extractPRNumber`); duplicate logic in `src/commands/utils/parsePRInput.ts`.

**The problem:** Both parsers extract only the PR *number* from a URL. If the user pastes `https://github.com/other-org/other-repo/pull/57`, the extension fetches PR #57 of the **current** repo without warning — plausibly a real PR with completely different content, leading to cherry-picking the wrong commits.

**How to fix:**
1. Extend `parsePRInput` to also capture owner/repo: return `{ prNumber, owner?, repo? }`.
2. In `PrCloneWebViewProvider.handleFetchPR` and `CheckoutByPRCommand.execute`, when owner/repo are present and differ (case-insensitive) from `ghClient.owner/repo` (or `git.getRepoInfo()`), show an error: "This PR URL belongs to <owner>/<repo>, but the current repository is <owner2>/<repo2>." and abort.
3. Delete `extractPRNumber` and use the shared `parsePRInput` in the webview provider (single source of truth; update `INVALID_PR_INPUT_MESSAGE` usage accordingly).

---

## 19. 🟡 Commit ordering by timestamp can reorder PR commits incorrectly

**Where:** `src/utils/commitsGenerator.ts:16-29`; `getCommitTimestamp` in `gitExecutor.ts:631-639` (errors collapse to `timestamp: 0`).

**The problem:** Cherry-pick order is derived by sorting selected commits by committer timestamp. Commits created within the same second (squash-rebases, scripted commits) or with identical timestamps have unstable order; commits whose timestamp lookup fails sort to position 0. Wrong order ⇒ avoidable cherry-pick conflicts. The GitHub API already returns PR commits **in topological order** (`fetchPullRequestCommits`), which is the correct order to replay.

**How to fix:** Preserve the API order instead of re-sorting: in `PrCommitsWebViewProvider`/`PrCloneWebViewProvider`, the `commits` array from `fetchPullRequestCommits` is ordered; pass `selectedCommits` through in that order (filter the ordered list by the selected set) and have `CommitsGenerator` keep input order (drop the timestamp sort, keep `current/total` bookkeeping). Keep `getCommitTimestamp` only if needed elsewhere. Update `prCloneTempWorktreeService.cherryPickCommits` accordingly.

---

## 20. 🟡 Temp-worktree mode: user cancellation surfaces as an error ("Failed to clone PR: Cancel operation")

**Where:** `src/services/prCloneTempWorktreeService.ts:44-46` et al. (`throw new Error('Cancel operation')`), caught at lines 116-133 where it is shown via `window.showErrorMessage`.

**How to fix:** Introduce a sentinel (`class OperationCancelledError extends Error {}`), throw it on `token.isCancellationRequested`, and in the outer catch show an information message ("PR clone cancelled") or nothing when `error instanceof OperationCancelledError`. Keep branch/worktree cleanup as-is.

---

## 21. 🟡 Assorted smaller defects

| # | Where | Problem | Fix |
|---|-------|---------|-----|
| a | `src/extension.ts:325` | `context.globalState.update('commandManager', commandManager)` stores a non-serializable object (Map, closures) in globalState; it serializes to junk and bloats storage. | Delete the line; for tests expose the manager via the activate return value or a test-only export. |
| b | `src/extension.ts:328-331` | `deactivate` logs `Extension "my-vscode-extension" is now deactivated!` — leftover template name. | Use `EXTENSION_NAME`. |
| c | `src/configuration/configurationManager.ts:16-66` | Constructor and `reload()` duplicate the entire config-reading block. | Extract a private `readConfig(): ExtensionConfig` used by both. |
| d | `src/configuration/configurationManager.ts:68-77` | Reads `jira.email` as a fallback, but `git-smart-checkout.jira.email` is not declared in `package.json` `contributes.configuration` — undiscoverable and unvalidated. | Either declare the key (with deprecation note) or drop the fallback. |
| e | `src/webview/Apps/PR/App/index.tsx:16-42` | Webview state persisted via `localStorage`, which VS Code does not guarantee for webviews (cleared on webview process recycle). | Use the official API: `acquireVsCodeApi().getState()/setState()` (already wrapped by `useSendMessage`'s vscode handle) instead of `localStorage`. |
| f | `src/view/PrCloneWebViewProvider.ts:494-498` | Provider `dispose()` disposes the shared `PrCloneService`, which it does not own; both providers + service are in `context.subscriptions`, risking double-dispose ordering issues. | Remove the call; let `extension.ts` push `prCloneService` (wrapped as `{ dispose: () => prCloneService.dispose() }`) into subscriptions once. |
| g | `src/utils/getGitExecutor.ts:12-19` | Assumes every workspace folder root *is* the git repo root. Repos opened from a subdirectory, or nested repos, are not detected. | Resolve the real root with `git rev-parse --show-toplevel` (via `execCommand`) for the chosen folder before constructing `GitExecutor`; surface a clear error if the folder is not a repo. |
| h | `src/services/prCloneTempWorktreeService.ts:287-293` | `cleanupOtherTempWorktrees` calls `fs.lstatSync(worktree)` on every listed worktree; a stale/pruned worktree path throws and aborts the whole cleanup loop (caught, but no cleanup happens). | Wrap the predicate in try/catch per item (`fs.existsSync` first), and run `git worktree prune` before listing. |
| i | `src/services/tagTemplateService.ts:331-352` | `result.replace(token.full, value)` — `String.replace` interprets `$&`, `$'` etc. in `value`; a script/file token producing `$&` corrupts the tag/branch name. | Use the function form: `result.replace(token.full, () => value)`. Same in `branchTemplateService.ts:146`. |
| j | `src/commands/checkoutToCommand/index.ts:274-276` | User dismissing the picker throws `new Error()` with an empty message used as control flow; depends on `message &&` guards downstream and pollutes telemetry if ever captured. | Return `undefined` and early-return in `execute()` instead of throwing. |
| k | `package.json` `engines.vscode: ^1.74.0` | Code relies on `git merge-tree --write-tree` (git ≥ 2.38) silently and on QuickPick APIs from newer versions; minimum engine not re-validated. | Verify each API against 1.74 or bump `engines.vscode`; gate the merge-tree preview on a one-time `git --version` check with a logged fallback. |

---

# Improvements and new feature ideas

Suggestions ordered roughly by value/effort. Items 1–4 strengthen what exists; 5+ are new capabilities.

1. **Worktree Explorer view.** The extension has six worktree commands but no visibility. Add a tree view in the existing activity-bar container listing worktrees (branch, path, dirty state, PR-review tag from `PRReviewWorktreeStore`), with inline actions: open, open in new window, remove, copy WIP here, open dev terminal. All the underlying operations already exist in `GitExecutor`/commands — this is mostly UI.
2. ✅ **Stash manager for auto-stashes.** (Done) Auto-stash modes create stashes the user can't easily see. Add a quick-pick command "GSC: Manage auto-stashes" listing stashes with the `auto-stash-` prefix (branch, age, files), with apply/pop/drop/diff actions. This also rescues users after Issue 12-style pop failures.
3. **Multi-remote support.** `origin` is hardcoded in `fetchSpecificBranch`, `pushBranchToGitHub`, `checkout`, `pushTag` default, etc. Add a `git-smart-checkout.defaultRemote` setting and/or detect the remote per branch (`%(upstream:remotename)`), and a remote picker when multiple exist. Pairs with the Issue 5 fix.
4. ✅ **Use VS Code SecretStorage for the Jira token.** (Done — PR #106) `git-smart-checkout.jira.token` currently lives in plaintext settings (and may be synced via Settings Sync). Migrate to `context.secrets` with a "GSC: Set Jira token" command; keep a one-time migration that reads the old setting, stores it as secret, and clears the setting.
5. **Recent branches / MRU checkout.** Extend `checkoutPrevious` into a "Checkout recent..." picker built from `git reflog` checkout entries (the parsing in `getPreviousBranch` already does 90% of this) showing the last N distinct branches with timestamps.
6. **Branch cleanup command.** "GSC: Delete merged branches…" — list local branches fully merged into the default branch (`git branch --merged`), multi-select quick pick, batch delete with a summary; optionally include `gone`-upstream branches (data already parsed in `#parseTrackData`).
7. **Open merge editor on stash-pop conflicts.** When `popStash` after checkout reports conflicts, offer "Resolve conflicts" that focuses the SCM view / opens the merge editor for the conflicted files (`getConflictedFiles` already exists), mirroring what the cherry-pick conflict flow does.
8. **PR clone: draft description editor + template support.** Pre-fill the description field from the original PR body and the repo's `.github/PULL_REQUEST_TEMPLATE.md`; show a markdown preview toggle in the webview.
9. **Status bar quick-actions menu.** Clicking the status bar item currently only switches stash mode. Make it open a small menu: switch mode, checkout to…, pull with stash, move to worktree, manage stashes — making the status item a hub for the extension.
10. **GitLab/Bitbucket graceful handling.** `getRepoInfo` only matches github.com. Detect non-GitHub remotes and either hide PR-related commands (context key, same pattern as `canCreateBranchFromTemplate`) or show a targeted message; longer-term, abstract `GitHubClient` behind an interface to add GitLab MR support.
11. **GitHub Enterprise support.** Allow a configurable API base URL + hostname match list, replacing the hardcoded `https://api.github.com` and `github.com` regexes (`ghClient.ts:8`, `gitExecutor.ts:666`).
12. **Auto-fetch before showing the branch list.** Optional setting: kick off `git fetch --all --prune` in the background when the checkout picker opens, refreshing items when done (infrastructure for live item refresh already exists in `refreshRemainingRefDetails`).
13. **Webview accessibility & resilience pass.** Replace `alert()` in `PrInputForm` with inline validation text, add `aria-busy` on loading buttons, and handle `acquireVsCodeApi` re-acquisition (it throws if called twice across HMR reloads).
14. **Rate-limit awareness in `GitHubClient`.** Read `x-ratelimit-remaining`/`retry-after` headers, back off and surface "GitHub rate limit reached, retry at HH:MM" instead of a raw 403 body dump.
15. **Telemetry transparency.** Document every `AnalyticsEvent` in the README, and consider switching `telemetry.enabled` default to opt-in (or at minimum show a one-time notification on first activation pointing to the setting), since the extension currently captures events whenever VS Code-level telemetry is on.
