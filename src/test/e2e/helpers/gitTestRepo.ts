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

  execSync('git init --bare', { cwd: repoPath, stdio: 'pipe' });
  execSync('git symbolic-ref HEAD refs/heads/main', { cwd: repoPath, stdio: 'pipe' });

  return repoPath;
}

/**
 * Standard two-branch repo. main has file1.txt; feature adds feature.txt.
 * The branches do NOT conflict on shared files.
 */
export function createTestRepo(): TestRepo {
  return buildRepo('gsc-test-', (repoPath, exec) => {
    fs.writeFileSync(path.join(repoPath, 'file1.txt'), 'initial content\n');
    exec('git add file1.txt');
    exec('git commit -m "init: initial commit"');

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
