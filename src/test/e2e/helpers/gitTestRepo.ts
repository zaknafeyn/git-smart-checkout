import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

import { GitExecutor } from '../../../common/git/gitExecutor';

import { mockLogService } from './mockLogService';

export interface TestRepo {
  repoPath: string;
  git: GitExecutor;
  mainBranch: string;
  featureBranch: string;
  exec(command: string): string;
  fileExists(filename: string): boolean;
  readFile(filename: string): string;
  makeChange(filename?: string, content?: string): void;
  stashCount(): number;
  cleanup(): void;
}

function buildRepo(
  prefix: string,
  setupBranches: (repoPath: string, exec: (cmd: string) => void) => void
): TestRepo {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const mainBranch = 'main';
  const featureBranch = 'feature';

  function exec(cmd: string) {
    execSync(cmd, { cwd: repoPath, stdio: 'pipe' });
  }

  exec('git init -b main');
  exec('git config user.email "test@test.local"');
  exec('git config user.name "Test"');

  setupBranches(repoPath, exec);

  exec(`git checkout ${mainBranch}`);

  const git = new GitExecutor(repoPath, mockLogService);

  return {
    repoPath,
    git,
    mainBranch,
    featureBranch,
    exec(command: string): string {
      return execSync(command, { cwd: repoPath, encoding: 'utf-8' });
    },
    fileExists(filename: string): boolean {
      return fs.existsSync(path.join(repoPath, filename));
    },
    readFile(filename: string): string {
      return fs.readFileSync(path.join(repoPath, filename), 'utf-8');
    },
    makeChange(filename = 'file1.txt', content = 'dirty change\n') {
      fs.writeFileSync(path.join(repoPath, filename), content);
    },
    stashCount() {
      try {
        const out = execSync('git stash list --format="%gs"', { cwd: repoPath, encoding: 'utf-8' });
        return out.trim().split('\n').filter((l) => l.trim() !== '').length;
      } catch {
        return 0;
      }
    },
    cleanup() {
      fs.rmSync(repoPath, { recursive: true, force: true });
    },
  };
}

function createBareRepo(prefix: string): string {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), prefix));

  // Set the initial branch at init time rather than via a follow-up
  // `git symbolic-ref`, which auto-discovers the bare repo from the cwd and is
  // rejected when the user has `safe.bareRepository=explicit` configured.
  execSync('git init --bare -b main', { cwd: repoPath, stdio: 'pipe' });

  return repoPath;
}

/**
 * Standard two-branch repo. main has file1.txt; feature adds feature.txt.
 * The branches do NOT conflict on shared files. A `v1.0.0` tag points at the
 * initial commit on main, used to exercise tag checkout.
 */
export function createTestRepo(): TestRepo {
  return buildRepo('gsc-test-', (repoPath, exec) => {
    fs.writeFileSync(path.join(repoPath, 'file1.txt'), 'initial content\n');
    exec('git add file1.txt');
    exec('git commit -m "init: initial commit"');

    exec('git tag v1.0.0');

    exec('git checkout -b feature');
    fs.writeFileSync(path.join(repoPath, 'feature.txt'), 'feature content\n');
    exec('git add feature.txt');
    exec('git commit -m "feat: add feature file"');
  });
}

export interface TagTestRepo extends TestRepo {
  remoteRepoPath: string;
  remoteHasTag(tagName: string): boolean;
}

export interface PullTestRepo extends TestRepo {
  remoteRepoPath: string;
  producerRepoPath: string;
}

/**
 * Repo with a bare sibling registered as origin, for testing tag push operations.
 */
export function createTagTestRepo(): TagTestRepo {
  const remoteRepoPath = createBareRepo('gsc-tag-remote-');

  const base = buildRepo('gsc-tag-test-', (repoPath, exec) => {
    fs.writeFileSync(path.join(repoPath, 'file1.txt'), 'initial content\n');
    exec('git add file1.txt');
    exec('git commit -m "init: initial commit"');
  });

  function execInRepo(cmd: string) {
    execSync(cmd, { cwd: base.repoPath, stdio: 'pipe' });
  }

  execInRepo(`git remote add origin "${remoteRepoPath}"`);
  execInRepo('git push -u origin main');

  const originalCleanup = base.cleanup.bind(base);

  return {
    ...base,
    remoteRepoPath,
    remoteHasTag(tagName: string): boolean {
      try {
        const out = execSync(`git tag --list "${tagName}"`, {
          cwd: remoteRepoPath,
          encoding: 'utf-8',
        });
        return out.trim() === tagName;
      } catch {
        return false;
      }
    },
    cleanup() {
      originalCleanup();
      fs.rmSync(remoteRepoPath, { recursive: true, force: true });
    },
  };
}

/**
 * Repo with a tracked origin/main and a second clone that has already pushed
 * one remote-only commit. Useful for command-level pull tests.
 */
export function createPullTestRepo(): PullTestRepo {
  const remoteRepoPath = createBareRepo('gsc-pull-remote-');

  const base = buildRepo('gsc-pull-test-', (repoPath, exec) => {
    fs.writeFileSync(path.join(repoPath, 'file1.txt'), 'initial content\n');
    exec('git add file1.txt');
    exec('git commit -m "init: initial commit"');
  });

  function execInRepo(cmd: string) {
    execSync(cmd, { cwd: base.repoPath, stdio: 'pipe' });
  }

  execInRepo(`git remote add origin "${remoteRepoPath}"`);
  execInRepo('git push -u origin main');

  const producerRepoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'gsc-pull-producer-'));
  fs.rmSync(producerRepoPath, { recursive: true, force: true });
  execSync(`git clone "${remoteRepoPath}" "${producerRepoPath}"`, { stdio: 'pipe' });
  execSync('git config user.email "test@test.local"', { cwd: producerRepoPath, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: producerRepoPath, stdio: 'pipe' });
  fs.writeFileSync(path.join(producerRepoPath, 'remote.txt'), 'remote content\n');
  execSync('git add remote.txt', { cwd: producerRepoPath, stdio: 'pipe' });
  execSync('git commit -m "feat: remote change"', { cwd: producerRepoPath, stdio: 'pipe' });
  execSync('git push origin main', { cwd: producerRepoPath, stdio: 'pipe' });

  const originalCleanup = base.cleanup.bind(base);

  return {
    ...base,
    remoteRepoPath,
    producerRepoPath,
    cleanup() {
      originalCleanup();
      fs.rmSync(remoteRepoPath, { recursive: true, force: true });
      fs.rmSync(producerRepoPath, { recursive: true, force: true });
    },
  };
}

/**
 * Conflict-prone repo. Both branches modify file1.txt divergently so that
 * stashing changes from main and popping/applying them on feature will conflict.
 */
export function createConflictTestRepo(): TestRepo {
  return buildRepo('gsc-conflict-test-', (repoPath, exec) => {
    fs.writeFileSync(path.join(repoPath, 'file1.txt'), 'initial content\n');
    exec('git add file1.txt');
    exec('git commit -m "init: initial commit"');

    exec('git checkout -b feature');
    fs.writeFileSync(path.join(repoPath, 'file1.txt'), 'feature version of file1\n');
    exec('git add file1.txt');
    exec('git commit -m "feat: modify file1 on feature branch"');
  });
}

/**
 * Rebase-friendly repo. feature and main diverge from the initial commit without
 * conflicting, and the working branch is feature.
 */
export function createRebaseTestRepo(): TestRepo {
  const repo = buildRepo('gsc-rebase-test-', (repoPath, exec) => {
    fs.writeFileSync(path.join(repoPath, 'file1.txt'), 'initial content\n');
    exec('git add file1.txt');
    exec('git commit -m "init: initial commit"');

    exec('git checkout -b feature');
    fs.writeFileSync(path.join(repoPath, 'feature.txt'), 'feature content\n');
    exec('git add feature.txt');
    exec('git commit -m "feat: add feature file"');

    exec('git checkout main');
    fs.writeFileSync(path.join(repoPath, 'main.txt'), 'main content\n');
    exec('git add main.txt');
    exec('git commit -m "feat: add main file"');

    exec('git tag main-tip');
    exec('git update-ref refs/remotes/origin/main main');
  });

  repo.exec('git checkout feature');
  return repo;
}

export interface PRTestRepo extends TestRepo {
  remoteRepoPath: string;
  prBranch: string;
}

/**
 * Repo with a bare sibling registered as origin. The remote has a `pr-feature`
 * branch that does NOT exist locally, simulating a PR branch to be fetched.
 */
export function createPRTestRepo(): PRTestRepo {
  const remoteRepoPath = createBareRepo('gsc-pr-remote-');

  const prBranch = 'pr-feature';

  const base = buildRepo('gsc-pr-test-', (repoPath, exec) => {
    fs.writeFileSync(path.join(repoPath, 'file1.txt'), 'initial content\n');
    exec('git add file1.txt');
    exec('git commit -m "init: initial commit"');
  });

  function execInRepo(cmd: string) {
    execSync(cmd, { cwd: base.repoPath, stdio: 'pipe' });
  }

  execInRepo(`git remote add origin "${remoteRepoPath}"`);
  execInRepo('git push -u origin main');

  execInRepo(`git checkout -b ${prBranch}`);
  fs.writeFileSync(path.join(base.repoPath, 'pr.txt'), 'pr content\n');
  execInRepo('git add pr.txt');
  execInRepo('git commit -m "feat: pr feature"');
  execInRepo(`git push -u origin ${prBranch}`);
  execInRepo('git checkout main');
  execInRepo(`git branch -D ${prBranch}`);

  const originalCleanup = base.cleanup.bind(base);

  return {
    ...base,
    remoteRepoPath,
    prBranch,
    cleanup() {
      originalCleanup();
      fs.rmSync(remoteRepoPath, { recursive: true, force: true });
    },
  };
}

export interface TwoRemoteTestRepo extends TestRepo {
  originRepoPath: string;
  upstreamRepoPath: string;
  remoteOnlyBranch: string;
}

/**
 * Repo with two bare remotes (`origin` and `upstream`). A `feat` branch exists on
 * BOTH remotes (so `git checkout feat` without an explicit remote is ambiguous)
 * but does NOT exist locally. Used to verify that remote-branch existence checks
 * resolve against `refs/remotes/<remote>/<branch>` and that checkout creates a
 * local tracking branch from the named remote.
 */
export function createTwoRemoteTestRepo(): TwoRemoteTestRepo {
  const originRepoPath = createBareRepo('gsc-2remote-origin-');
  const upstreamRepoPath = createBareRepo('gsc-2remote-upstream-');

  const remoteOnlyBranch = 'feat';

  const base = buildRepo('gsc-2remote-test-', (repoPath, exec) => {
    fs.writeFileSync(path.join(repoPath, 'file1.txt'), 'initial content\n');
    exec('git add file1.txt');
    exec('git commit -m "init: initial commit"');
  });

  function execInRepo(cmd: string) {
    execSync(cmd, { cwd: base.repoPath, stdio: 'pipe' });
  }

  execInRepo(`git remote add origin "${originRepoPath}"`);
  execInRepo(`git remote add upstream "${upstreamRepoPath}"`);
  execInRepo('git push -u origin main');
  execInRepo('git push upstream main');

  // Create the feat branch, push it to both remotes, then drop it locally so it
  // only exists as a remote-tracking ref on origin AND upstream.
  execInRepo(`git checkout -b ${remoteOnlyBranch}`);
  fs.writeFileSync(path.join(base.repoPath, 'feat.txt'), 'feat content\n');
  execInRepo('git add feat.txt');
  execInRepo('git commit -m "feat: add feat file"');
  execInRepo(`git push origin ${remoteOnlyBranch}`);
  execInRepo(`git push upstream ${remoteOnlyBranch}`);
  execInRepo('git checkout main');
  execInRepo(`git branch -D ${remoteOnlyBranch}`);

  const originalCleanup = base.cleanup.bind(base);

  return {
    ...base,
    originRepoPath,
    upstreamRepoPath,
    remoteOnlyBranch,
    cleanup() {
      originalCleanup();
      fs.rmSync(originRepoPath, { recursive: true, force: true });
      fs.rmSync(upstreamRepoPath, { recursive: true, force: true });
    },
  };
}

export interface ForkPRTestRepo extends PRTestRepo {
  forkRepoPath: string;
  forkBranch: string;
}

/**
 * Extends PRTestRepo with a separate bare "fork" remote. The fork remote has a
 * `fork-feature` branch that does NOT exist locally, simulating a PR from a fork.
 */
export function createForkPRTestRepo(): ForkPRTestRepo {
  const base = createPRTestRepo() as ForkPRTestRepo;

  const forkRepoPath = createBareRepo('gsc-fork-remote-');

  const forkBranch = 'fork-feature';

  function execInRepo(cmd: string) {
    execSync(cmd, { cwd: base.repoPath, stdio: 'pipe' });
  }

  execInRepo(`git checkout -b ${forkBranch}`);
  fs.writeFileSync(path.join(base.repoPath, 'fork.txt'), 'fork content\n');
  execInRepo('git add fork.txt');
  execInRepo('git commit -m "feat: fork feature"');
  execInRepo(`git push "${forkRepoPath}" ${forkBranch}`);
  execInRepo('git checkout main');
  execInRepo(`git branch -D ${forkBranch}`);

  const originalCleanup = base.cleanup.bind(base);

  return {
    ...base,
    forkRepoPath,
    forkBranch,
    cleanup() {
      originalCleanup();
      fs.rmSync(forkRepoPath, { recursive: true, force: true });
    },
  };
}

export interface PRNumberTestRepo extends TestRepo {
  remoteRepoPath: string;
  prNumber: number;
  headSha: string;
  /** Pushes a new commit onto the synthetic `refs/pull/<n>/head` ref and returns its SHA. */
  advancePullRef(): string;
}

/**
 * Repo with a bare sibling registered as origin. A synthetic `refs/pull/<n>/head`
 * ref is created directly on the remote (as GitHub does for PR heads), without a
 * corresponding local or remote-tracking branch — simulating a PR reviewed purely
 * by number via `GitExecutor.fetchPullRequestHead`.
 */
export function createPRNumberTestRepo(prNumber = 7): PRNumberTestRepo {
  const remoteRepoPath = createBareRepo('gsc-pr-number-remote-');

  const base = buildRepo('gsc-pr-number-test-', (repoPath, exec) => {
    fs.writeFileSync(path.join(repoPath, 'file1.txt'), 'initial content\n');
    exec('git add file1.txt');
    exec('git commit -m "init: initial commit"');
  });

  function execInRepo(cmd: string): string {
    return execSync(cmd, { cwd: base.repoPath, encoding: 'utf-8' });
  }

  execInRepo(`git remote add origin "${remoteRepoPath}"`);
  execInRepo('git push -u origin main');

  function pushPullRefCommit(branchName: string, content: string): string {
    execInRepo(`git checkout -b ${branchName}`);
    fs.writeFileSync(path.join(base.repoPath, 'pr.txt'), content);
    execInRepo('git add pr.txt');
    execInRepo(`git commit -m "feat: ${branchName}"`);
    const sha = execInRepo('git rev-parse HEAD').trim();
    // Force-push: a PR head advancing (e.g. after a rebase/force-push by the
    // author) is a non-fast-forward update to the synthetic pull ref.
    execInRepo(`git push --force "${remoteRepoPath}" HEAD:refs/pull/${prNumber}/head`);
    execInRepo('git checkout main');
    execInRepo(`git branch -D ${branchName}`);
    return sha;
  }

  const headSha = pushPullRefCommit('pr-source', 'pr content v1\n');

  const originalCleanup = base.cleanup.bind(base);

  return {
    ...base,
    remoteRepoPath,
    prNumber,
    headSha,
    advancePullRef(): string {
      return pushPullRefCommit('pr-source-advance', `pr content v2 ${Date.now()}\n`);
    },
    cleanup() {
      originalCleanup();
      fs.rmSync(remoteRepoPath, { recursive: true, force: true });
    },
  };
}

export interface WorktreeTestRepo extends TestRepo {
  worktreePath: string;
  worktreeBranch: string;
}

/**
 * Repo where a feature branch is already checked out in a sibling worktree.
 * Main is the active branch. The reflog naturally points back to the worktree
 * branch, making it the "previous branch" for CheckoutPreviousCommand tests.
 */
export function createWorktreeTestRepo(): WorktreeTestRepo {
  const worktreeBranch = 'feature-in-worktree';

  const base = buildRepo('gsc-wt-test-', (repoPath, exec) => {
    fs.writeFileSync(path.join(repoPath, 'file1.txt'), 'initial content\n');
    exec('git add file1.txt');
    exec('git commit -m "init: initial commit"');

    exec(`git checkout -b ${worktreeBranch}`);
    fs.writeFileSync(path.join(repoPath, 'feature.txt'), 'feature content\n');
    exec('git add feature.txt');
    exec('git commit -m "feat: add feature file"');
  });

  const worktreePath = fs.mkdtempSync(path.join(os.tmpdir(), 'gsc-wt-'));
  fs.rmSync(worktreePath, { recursive: true, force: true });
  base.exec(`git worktree add "${worktreePath}" ${worktreeBranch}`);

  const originalCleanup = base.cleanup.bind(base);

  return {
    ...base,
    worktreePath,
    worktreeBranch,
    cleanup() {
      try { base.exec(`git worktree remove --force "${worktreePath}"`); } catch {}
      fs.rmSync(worktreePath, { recursive: true, force: true });
      originalCleanup();
    },
  };
}

export interface PRWorktreeTestRepo extends PRTestRepo {
  prWorktreePath: string;
}

/**
 * Extends PRTestRepo with the PR branch also checked out in a local worktree,
 * simulating the case where a previous PR review left the branch attached.
 */
export function createPRWorktreeTestRepo(): PRWorktreeTestRepo {
  const base = createPRTestRepo();

  // Recreate the local branch from the remote so we can attach it to a worktree.
  base.exec(`git fetch origin ${base.prBranch}:${base.prBranch}`);

  const prWorktreePath = fs.mkdtempSync(path.join(os.tmpdir(), 'gsc-pr-wt-'));
  fs.rmSync(prWorktreePath, { recursive: true, force: true });
  base.exec(`git worktree add "${prWorktreePath}" ${base.prBranch}`);

  const originalCleanup = base.cleanup.bind(base);

  return {
    ...base,
    prWorktreePath,
    cleanup() {
      try { base.exec(`git worktree remove --force "${prWorktreePath}"`); } catch {}
      fs.rmSync(prWorktreePath, { recursive: true, force: true });
      originalCleanup();
    },
  };
}

/**
 * Rebase-conflict repo. feature and main both commit different versions of
 * file1.txt, and the working branch is feature.
 */
export function createRebaseConflictTestRepo(): TestRepo {
  const repo = buildRepo('gsc-rebase-conflict-test-', (repoPath, exec) => {
    fs.writeFileSync(path.join(repoPath, 'file1.txt'), 'initial content\n');
    exec('git add file1.txt');
    exec('git commit -m "init: initial commit"');

    exec('git checkout -b feature');
    fs.writeFileSync(path.join(repoPath, 'file1.txt'), 'feature committed content\n');
    exec('git add file1.txt');
    exec('git commit -m "feat: modify file1 on feature"');

    exec('git checkout main');
    fs.writeFileSync(path.join(repoPath, 'file1.txt'), 'main committed content\n');
    exec('git add file1.txt');
    exec('git commit -m "feat: modify file1 on main"');
  });

  repo.exec('git checkout feature');
  return repo;
}

// ---------------------------------------------------------------------------
// Heavy repository: ~28 mock files across nested directories, several diverging
// branches, a local bare origin (+ producer clone), a remote-only PR branch and
// a fork remote. Used by the opt-in heavy test suite to exercise the main
// features over a large, complex repository instead of a 1–2 file fixture.
// ---------------------------------------------------------------------------

/** Description of the mixed working-tree state produced by seedComplexWorkingState. */
export interface ComplexWorkingState {
  /** Files staged with `git add` (modified or, for the rename target, added). */
  staged: string[];
  /** Tracked files modified but left unstaged. */
  modifiedUnstaged: string[];
  /** Files staged and then modified again (status `MM`). */
  mixed: string[];
  /** Brand-new untracked files (some in new directories). */
  untracked: string[];
  /** Tracked files deleted from the working tree (unstaged deletion). */
  deleted: string[];
  /** Staged rename. */
  renamed: { from: string; to: string };
}

export interface HeavyTestRepo extends TestRepo {
  remoteRepoPath: string;
  producerRepoPath: string;
  forkRepoPath: string;
  /** Remote-only PR branch on origin (not present locally). */
  prBranch: string;
  /** Branch that only exists on the fork remote. */
  forkBranch: string;
  uiBranch: string;
  apiBranch: string;
  releaseBranch: string;
  /** Branch that commits a divergent version of conflictFile. */
  conflictBranch: string;
  /** Tracked file that conflictBranch and a dirty working tree both modify. */
  conflictFile: string;
  /** All files committed on the main baseline. */
  trackedFiles: string[];
  /** Dirty the working tree into staged/unstaged/untracked/deleted/renamed all at once. */
  seedComplexWorkingState(): ComplexWorkingState;
}

/**
 * ~28 files of plausible mock data spread across nested directories and file
 * types (TS source, JSON/YAML config, Markdown docs, JSON fixtures).
 */
function heavyBaselineFiles(): Record<string, string> {
  const tsModule = (name: string, body: string) =>
    `// ${name}\nexport function ${name}() {\n${body}\n}\n`;

  return {
    'README.md': '# Heavy Sample Project\n\nA fixture project used for heavy e2e tests.\n',
    '.gitignore': 'node_modules/\ndist/\n*.log\n',
    'package.json': JSON.stringify(
      { name: 'heavy-sample', version: '1.0.0', private: true, scripts: { build: 'tsc' } },
      null,
      2
    ) + '\n',
    'src/index.ts': "import { startApp } from './app';\n\nstartApp();\n",
    'src/app.ts': "import { ApiService } from './services/apiService';\n\nexport function startApp() {\n  return new ApiService().init();\n}\n",
    'src/components/Button.ts': tsModule('Button', '  return { kind: "button", label: "Click" };'),
    'src/components/Modal.ts': tsModule('Modal', '  return { kind: "modal", open: false };'),
    'src/components/Header.ts': tsModule('Header', '  return { kind: "header", title: "Home" };'),
    'src/components/Footer.ts': tsModule('Footer', '  return { kind: "footer", year: 2024 };'),
    'src/services/apiService.ts': "export class ApiService {\n  init() {\n    return 'api:v1';\n  }\n}\n",
    'src/services/authService.ts': "export class AuthService {\n  login(user: string) {\n    return `auth:${user}`;\n  }\n}\n",
    'src/services/cacheService.ts': "export class CacheService {\n  private store = new Map<string, unknown>();\n  get(key: string) {\n    return this.store.get(key);\n  }\n}\n",
    'src/utils/format.ts': tsModule('format', '  return (value: string) => value.trim();'),
    'src/utils/validate.ts': tsModule('validate', '  return (value: string) => value.length > 0;'),
    'src/utils/logger.ts': tsModule('logger', '  return (message: string) => console.log(message);'),
    'src/hooks/useFetch.ts': tsModule('useFetch', '  return { loading: false, data: null };'),
    'src/hooks/useToggle.ts': tsModule('useToggle', '  return { on: false, toggle: () => undefined };'),
    'config/app.json': JSON.stringify({ name: 'heavy-sample', env: 'test', port: 3000 }, null, 2) + '\n',
    'config/database.json': JSON.stringify({ host: 'localhost', port: 5432, name: 'heavy' }, null, 2) + '\n',
    'config/feature-flags.yml': 'flags:\n  newUi: false\n  beta: true\n',
    'docs/getting-started.md': '# Getting Started\n\nClone, install, and run the build.\n',
    'docs/architecture.md': '# Architecture\n\nLayered: components -> services -> utils.\n',
    'docs/CONTRIBUTING.md': '# Contributing\n\nOpen a PR against main.\n',
    'data/users.json': JSON.stringify([{ id: 1, name: 'Ada' }, { id: 2, name: 'Linus' }], null, 2) + '\n',
    'data/products.json': JSON.stringify([{ sku: 'A1', price: 10 }, { sku: 'B2', price: 20 }], null, 2) + '\n',
    'data/orders.json': JSON.stringify([{ id: 100, sku: 'A1', qty: 2 }], null, 2) + '\n',
    'tests/smoke.test.ts': "import { startApp } from '../src/app';\n\nstartApp();\n",
    'tests/fixtures.ts': "export const fixtures = { user: 'Ada' };\n",
  };
}

function writeDeep(repoPath: string, relativePath: string, content: string): void {
  const target = path.join(repoPath, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

export function createHeavyTestRepo(): HeavyTestRepo {
  const remoteRepoPath = createBareRepo('gsc-heavy-remote-');
  const forkRepoPath = createBareRepo('gsc-heavy-fork-');

  const uiBranch = 'feature/ui';
  const apiBranch = 'feature/api';
  const releaseBranch = 'release/1.x';
  const conflictBranch = 'feature/conflict';
  const conflictFile = 'src/utils/format.ts';
  const prBranch = 'pr-feature';
  const forkBranch = 'fork-feature';

  const baseline = heavyBaselineFiles();
  const trackedFiles = Object.keys(baseline);

  const base = buildRepo('gsc-heavy-test-', (repoPath, exec) => {
    for (const [relativePath, content] of Object.entries(baseline)) {
      writeDeep(repoPath, relativePath, content);
    }
    exec('git add -A');
    exec('git commit -m "init: heavy baseline"');

    // feature/ui — touches only components.
    exec(`git checkout -b ${uiBranch}`);
    writeDeep(repoPath, 'src/components/Button.ts', '// Button (ui)\nexport function Button() {\n  return { kind: "button", label: "Submit" };\n}\n');
    writeDeep(repoPath, 'src/components/Sidebar.ts', '// Sidebar (ui)\nexport function Sidebar() {\n  return { kind: "sidebar" };\n}\n');
    exec('git add -A');
    exec('git commit -m "feat(ui): restyle button and add sidebar"');
    exec('git checkout main');

    // feature/api — touches only services.
    exec(`git checkout -b ${apiBranch}`);
    writeDeep(repoPath, 'src/services/apiService.ts', "export class ApiService {\n  init() {\n    return 'api:v2';\n  }\n}\n");
    writeDeep(repoPath, 'src/services/webhookService.ts', "export class WebhookService {\n  emit(event: string) {\n    return `webhook:${event}`;\n  }\n}\n");
    exec('git add -A');
    exec('git commit -m "feat(api): bump api version and add webhook service"');
    exec('git checkout main');

    // release/1.x — touches package.json and docs.
    exec(`git checkout -b ${releaseBranch}`);
    writeDeep(repoPath, 'package.json', JSON.stringify(
      { name: 'heavy-sample', version: '1.1.0', private: true, scripts: { build: 'tsc' } },
      null,
      2
    ) + '\n');
    writeDeep(repoPath, 'docs/architecture.md', '# Architecture\n\nLayered: components -> services -> utils.\n\n## 1.1\nAdded webhook layer.\n');
    exec('git add -A');
    exec('git commit -m "chore(release): prepare 1.1.0"');
    exec('git checkout main');

    // feature/conflict — commits a divergent version of conflictFile.
    exec(`git checkout -b ${conflictBranch}`);
    writeDeep(repoPath, conflictFile, '// format (conflict branch)\nexport function format() {\n  return (value: string) => value.toUpperCase();\n}\n');
    exec('git add -A');
    exec('git commit -m "feat: change format on conflict branch"');
    exec('git checkout main');
  });

  function execInRepo(cmd: string) {
    execSync(cmd, { cwd: base.repoPath, stdio: 'pipe' });
  }

  // origin: push main (with upstream tracking) so pull/rebase have a remote.
  execInRepo(`git remote add origin "${remoteRepoPath}"`);
  execInRepo('git push -u origin main');

  // Remote-only PR branch on origin.
  execInRepo(`git checkout -b ${prBranch}`);
  writeDeep(base.repoPath, 'src/features/prFeature.ts', "export const prFeature = () => 'pr-feature';\n");
  execInRepo('git add -A');
  execInRepo('git commit -m "feat: pr feature"');
  execInRepo(`git push -u origin ${prBranch}`);
  execInRepo('git checkout main');
  execInRepo(`git branch -D ${prBranch}`);

  // Fork-only branch on the fork remote.
  execInRepo(`git checkout -b ${forkBranch}`);
  writeDeep(base.repoPath, 'src/features/forkFeature.ts', "export const forkFeature = () => 'fork-feature';\n");
  execInRepo('git add -A');
  execInRepo('git commit -m "feat: fork feature"');
  execInRepo(`git push "${forkRepoPath}" ${forkBranch}`);
  execInRepo('git checkout main');
  execInRepo(`git branch -D ${forkBranch}`);

  // Producer clone that pushes a divergent commit touching several files, so the
  // local main is behind origin/main and a pull has something to integrate.
  const producerRepoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'gsc-heavy-producer-'));
  fs.rmSync(producerRepoPath, { recursive: true, force: true });
  execSync(`git clone "${remoteRepoPath}" "${producerRepoPath}"`, { stdio: 'pipe' });
  execSync('git config user.email "test@test.local"', { cwd: producerRepoPath, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: producerRepoPath, stdio: 'pipe' });
  writeDeep(producerRepoPath, 'data/orders.json', JSON.stringify([{ id: 100, sku: 'A1', qty: 2 }, { id: 101, sku: 'B2', qty: 5 }], null, 2) + '\n');
  writeDeep(producerRepoPath, 'docs/CHANGELOG.md', '# Changelog\n\n- remote: add order 101\n');
  execSync('git add -A', { cwd: producerRepoPath, stdio: 'pipe' });
  execSync('git commit -m "feat: remote order and changelog"', { cwd: producerRepoPath, stdio: 'pipe' });
  execSync('git push origin main', { cwd: producerRepoPath, stdio: 'pipe' });

  const originalCleanup = base.cleanup.bind(base);

  return {
    ...base,
    remoteRepoPath,
    producerRepoPath,
    forkRepoPath,
    prBranch,
    forkBranch,
    uiBranch,
    apiBranch,
    releaseBranch,
    conflictBranch,
    conflictFile,
    trackedFiles,
    seedComplexWorkingState(): ComplexWorkingState {
      const staged = ['src/utils/validate.ts', 'data/users.json', 'config/app.json'];
      const modifiedUnstaged = ['src/services/cacheService.ts', 'docs/getting-started.md'];
      const mixed = ['src/utils/logger.ts'];
      const untracked = ['src/utils/wipHelper.ts', 'data/scratch.json', 'notes/todo.md'];
      const deleted = ['src/hooks/useToggle.ts'];
      const renamed = { from: 'tests/fixtures.ts', to: 'tests/fixtures.renamed.ts' };

      // Staged modifications.
      for (const file of staged) {
        writeDeep(base.repoPath, file, `${fs.readFileSync(path.join(base.repoPath, file), 'utf-8')}// staged edit\n`);
      }
      execInRepo(`git add ${staged.join(' ')}`);

      // Modified-but-unstaged.
      for (const file of modifiedUnstaged) {
        writeDeep(base.repoPath, file, `${fs.readFileSync(path.join(base.repoPath, file), 'utf-8')}// unstaged edit\n`);
      }

      // Staged then modified again (MM).
      for (const file of mixed) {
        writeDeep(base.repoPath, file, `${fs.readFileSync(path.join(base.repoPath, file), 'utf-8')}// first edit\n`);
        execInRepo(`git add ${file}`);
        writeDeep(base.repoPath, file, `${fs.readFileSync(path.join(base.repoPath, file), 'utf-8')}// second edit\n`);
      }

      // Untracked (including new directories).
      for (const file of untracked) {
        writeDeep(base.repoPath, file, `untracked ${file}\n`);
      }

      // Unstaged deletion.
      for (const file of deleted) {
        fs.rmSync(path.join(base.repoPath, file));
      }

      // Staged rename.
      execInRepo(`git mv ${renamed.from} ${renamed.to}`);

      return { staged, modifiedUnstaged, mixed, untracked, deleted, renamed };
    },
    cleanup() {
      originalCleanup();
      fs.rmSync(remoteRepoPath, { recursive: true, force: true });
      fs.rmSync(forkRepoPath, { recursive: true, force: true });
      fs.rmSync(producerRepoPath, { recursive: true, force: true });
    },
  };
}
