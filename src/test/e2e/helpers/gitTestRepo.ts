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
