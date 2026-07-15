import * as assert from 'assert';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import {
  commandId,
  delay,
  ensureExtensionActivated,
  stubErrorMessages,
  stubInformationMessages,
  stubShowQuickPickMany,
  stubWarningMessages,
  withRepoWorkspace,
} from './helpers/commandHarness';
import { createTestRepo, TestRepo } from './helpers/gitTestRepo';

type CleanupQuickPickLikeItem = vscode.QuickPickItem & {
  candidate?: { ref: { name: string; hash?: string }; group: 'merged' | 'gone' };
  picked?: boolean;
};

function execIn(cwd: string, command: string): string {
  return execSync(command, { cwd, encoding: 'utf-8' });
}

function branchExists(repo: TestRepo, branch: string): boolean {
  return execIn(repo.repoPath, `git branch --list ${branch}`).trim().length > 0;
}

function addWorktree(repo: TestRepo, branch: string, createFrom: string): string {
  const worktreePath = path.join(path.dirname(repo.repoPath), `${path.basename(repo.repoPath)}-${branch}`);
  execIn(repo.repoPath, `git worktree add "${worktreePath}" -b ${branch} ${createFrom}`);
  return worktreePath;
}

function cleanupWorktree(repo: TestRepo, worktreePath: string): void {
  try {
    execIn(repo.repoPath, `git worktree remove "${worktreePath}" --force`);
  } catch {
    // The worktree may already be gone.
  }
  fs.rmSync(worktreePath, { recursive: true, force: true });
}

/**
 * Builds: `merged-1`/`merged-2` (merged into main, no upstream), `orphan`
 * (ahead of main so NOT merged, upstream deleted + pruned so `[gone]`),
 * `feature` (from {@link createTestRepo}, ahead of main, no upstream — an
 * "active" branch that must survive), and a worktree checked out on a branch
 * that would otherwise qualify as merged.
 */
function setupCleanupFixtures(repo: TestRepo): { worktreePath: string; remoteRepoPath: string } {
  execIn(repo.repoPath, 'git branch merged-1');
  execIn(repo.repoPath, 'git branch merged-2');

  const remoteRepoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'gsc-cleanup-remote-'));
  execSync('git init -q --bare -b main', { cwd: remoteRepoPath });
  execIn(repo.repoPath, `git remote add origin "${remoteRepoPath}"`);
  execIn(repo.repoPath, 'git push -q -u origin main');

  execIn(repo.repoPath, 'git checkout -q -b orphan');
  fs.writeFileSync(path.join(repo.repoPath, 'orphan.txt'), 'orphan content\n');
  execIn(repo.repoPath, 'git add orphan.txt');
  execIn(repo.repoPath, 'git commit -q -m "feat: orphan work"');
  execIn(repo.repoPath, 'git push -q -u origin orphan');
  execIn(repo.repoPath, 'git checkout -q main');
  execIn(repo.repoPath, 'git push -q origin --delete orphan');
  execIn(repo.repoPath, 'git fetch -q --prune');

  const worktreePath = addWorktree(repo, 'checked-out-elsewhere', 'main');

  return { worktreePath, remoteRepoPath };
}

function cleanupFixtures(repo: TestRepo, fixtures: { worktreePath: string; remoteRepoPath: string }): void {
  cleanupWorktree(repo, fixtures.worktreePath);
  fs.rmSync(fixtures.remoteRepoPath, { recursive: true, force: true });
}

describe('Cleanup branches command', () => {
  before(async () => {
    await ensureExtensionActivated();
  });

  it('computes merged ∪ gone-upstream candidates, grouped and pre-checked, excluding current/default/active/worktree branches', async () => {
    const repo = createTestRepo();
    const fixtures = setupCleanupFixtures(repo);
    let items: CleanupQuickPickLikeItem[] = [];
    const restoreQuickPick = stubShowQuickPickMany((rawItems, options) => {
      assert.strictEqual(options?.canPickMany, true);
      assert.ok(options?.title?.includes('base: main'));
      items = rawItems as CleanupQuickPickLikeItem[];
      return undefined; // dismiss: nothing should be deleted
    });
    const errors = stubErrorMessages();

    try {
      await withRepoWorkspace(repo, async () => {
        await vscode.commands.executeCommand(commandId('cleanupBranches'));

        const separators = items
          .filter((item) => item.kind === vscode.QuickPickItemKind.Separator)
          .map((item) => item.label);
        assert.deepStrictEqual(separators, ['Merged into main', 'Upstream deleted']);

        const candidateLabels = items.filter((item) => item.candidate).map((item) => item.label);
        assert.deepStrictEqual(candidateLabels.sort(), ['merged-1', 'merged-2', 'orphan'].sort());
        assert.ok(!candidateLabels.includes('feature'), 'unmerged active branch must not be a candidate');
        assert.ok(!candidateLabels.includes('main'), 'default branch must be excluded');
        assert.ok(
          !candidateLabels.includes('checked-out-elsewhere'),
          'a branch checked out in a worktree must never appear, even though otherwise merged'
        );

        const merged1 = items.find((item) => item.label === 'merged-1');
        const orphan = items.find((item) => item.label === 'orphan');
        assert.strictEqual(merged1?.picked, true, 'merged branches are pre-checked');
        assert.strictEqual(orphan?.picked, false, 'unmerged-gone branches are unchecked by default');
        assert.ok(orphan?.description?.includes('not merged'));

        assert.ok(branchExists(repo, 'merged-1'), 'dismissing the picker must not delete anything');
        assert.deepStrictEqual(errors.messages, []);
      });
    } finally {
      errors.restore();
      restoreQuickPick();
      cleanupFixtures(repo, fixtures);
      repo.cleanup();
    }
  });

  it('deletes checked candidates, keeps the unchecked one, reports a partial failure, and offers an undo-hint recovery document', async () => {
    const repo = createTestRepo();
    const fixtures = setupCleanupFixtures(repo);
    const restoreQuickPick = stubShowQuickPickMany((rawItems) => {
      const cleanupItems = (rawItems as CleanupQuickPickLikeItem[]).filter((item) => item.candidate);
      // Simulate a concurrent external deletion of merged-2 right before the batch runs.
      execIn(repo.repoPath, 'git branch -D merged-2');
      // "Accept" merged-1 and merged-2 (still shows as selected from the earlier state);
      // leave `orphan` unchecked, matching its default unchecked state.
      return cleanupItems.filter((item) => item.label === 'merged-1' || item.label === 'merged-2');
    });
    const warnings = stubWarningMessages((message, actionItems) => {
      assert.ok(message.includes('reflog for ~30 days'));
      return actionItems.includes('Delete') ? 'Delete' : undefined;
    });
    const info = stubInformationMessages((message) =>
      message.startsWith('Deleted') ? 'Undo hint' : undefined
    );
    const errors = stubErrorMessages();

    try {
      await withRepoWorkspace(repo, async () => {
        await vscode.commands.executeCommand(commandId('cleanupBranches'));

        assert.ok(!branchExists(repo, 'merged-1'), 'merged-1 should be deleted');
        assert.ok(branchExists(repo, 'orphan'), 'unchecked orphan branch must survive');
        assert.ok(
          info.messages.includes('Deleted 1 branches, 1 failed'),
          `expected a partial-failure summary, got: ${JSON.stringify(info.messages)}`
        );
        assert.deepStrictEqual(errors.messages, [], 'a per-branch delete failure must not surface as a command error');

        await delay();
        const document = vscode.window.activeTextEditor?.document;
        assert.ok(document, 'the "Undo hint" action should open a recovery document');
        const text = document!.getText();
        assert.ok(text.includes('git branch merged-1 '), 'recovery doc should list the successfully deleted branch');
        assert.ok(!text.includes('merged-2'), 'the failed deletion must not appear in the recovery doc');
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
      });
    } finally {
      errors.restore();
      info.restore();
      warnings.restore();
      restoreQuickPick();
      cleanupFixtures(repo, fixtures);
      repo.cleanup();
    }
  });

  it('shows an info toast and never opens a picker when there is nothing to clean up', async () => {
    const repo = createTestRepo();
    execIn(repo.repoPath, 'git branch -D feature');
    let quickPickShown = false;
    const restoreQuickPick = stubShowQuickPickMany(() => {
      quickPickShown = true;
      return undefined;
    });
    const info = stubInformationMessages(() => undefined);
    const errors = stubErrorMessages();

    try {
      await withRepoWorkspace(repo, async () => {
        await vscode.commands.executeCommand(commandId('cleanupBranches'));

        assert.strictEqual(quickPickShown, false);
        assert.deepStrictEqual(info.messages, ['No merged or orphaned branches to clean up.']);
        assert.deepStrictEqual(errors.messages, []);
      });
    } finally {
      errors.restore();
      info.restore();
      restoreQuickPick();
      repo.cleanup();
    }
  });
});
