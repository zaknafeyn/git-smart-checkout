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

/**
 * Repo with a bare sibling registered as origin, for testing tag push operations.
 */
export function createTagTestRepo(): TagTestRepo {
  const remoteRepoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'gsc-tag-remote-'));
  execSync('git init --bare', { cwd: remoteRepoPath, stdio: 'pipe' });

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
