import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { AUTO_STASH_MODE_MANUAL } from '../../configuration/extensionConfig';

import { createHeavyTestRepo } from '../e2e/helpers/gitTestRepo';
import {
  cleanupWorktree,
  commandId,
  ensureExtensionActivated,
  execIn,
  getDefaultWorktreePath,
  isSameTestPath,
  QuickPickLikeItem,
  setExtensionMode,
  stubCreateQuickPick,
  stubErrorMessages,
  stubInformationMessages,
  stubInputBox,
  stubShowQuickPick,
  withRepoWorkspace,
} from '../e2e/helpers/commandHarness';

/**
 * Heavy-repository coverage for the git-worktree commands, driven through the
 * real contributed commands. Exercises creating a worktree from a many-branch
 * repo and copying a multi-file WIP into a sibling worktree.
 */

describe('Heavy repo — worktree commands', () => {
  before(async () => {
    await ensureExtensionActivated();
    await setExtensionMode(AUTO_STASH_MODE_MANUAL);
  });

  it('creates a new worktree for a feature branch from a large repo', async () => {
    const repo = createHeavyTestRepo();
    const worktreePath = getDefaultWorktreePath(repo, repo.uiBranch);

    const restoreQuickPick = stubCreateQuickPick((items, quickPick) => {
      assert.strictEqual(quickPick.placeholder, 'Select a target branch for the new worktree');
      return items.find((item) => item.ref?.name === repo.uiBranch && !item.ref.remote);
    });
    const restoreInput = stubInputBox((options) => options.value);
    const info = stubInformationMessages(() => undefined);
    const errors = stubErrorMessages();

    try {
      await withRepoWorkspace(repo, async () => {
        await vscode.commands.executeCommand(commandId('moveToNewWorktree'));

        assert.deepStrictEqual(errors.messages, []);
        assert.strictEqual(fs.existsSync(worktreePath), true, 'worktree directory created');
        assert.strictEqual(
          execIn(worktreePath, 'git branch --show-current').trim(),
          repo.uiBranch,
          'worktree is checked out to the feature branch'
        );
        assert.strictEqual(
          fs.existsSync(path.join(worktreePath, 'src/components/Sidebar.ts')),
          true,
          'feature branch files are present in the worktree'
        );
      });
    } finally {
      errors.restore();
      info.restore();
      restoreInput();
      restoreQuickPick();
      await cleanupWorktree(repo, worktreePath);
      repo.cleanup();
    }
  });

  it('copies a multi-file WIP into a sibling worktree and preserves the source', async () => {
    const repo = createHeavyTestRepo();
    const worktreePath = getDefaultWorktreePath(repo, repo.apiBranch);

    // A sibling worktree checked out to a branch that shares these files with main.
    repo.exec(`git worktree add "${worktreePath}" ${repo.apiBranch}`);

    // Files identical between main and the target branch, so patches apply cleanly.
    const stagedFile = 'src/utils/validate.ts';
    const unstagedFile = 'docs/getting-started.md';
    const untrackedFile = 'data/wip.json';

    const restoreQuickPick = stubShowQuickPick((items, options) => {
      if (options?.placeHolder === 'Select a worktree to copy changes to') {
        return items.find((item) =>
          typeof item !== 'string' &&
          isSameTestPath((item as QuickPickLikeItem).worktree?.path, worktreePath)
        ) as vscode.QuickPickItem;
      }
      return undefined;
    });
    const info = stubInformationMessages(() => undefined);
    const errors = stubErrorMessages();

    try {
      await withRepoWorkspace(repo, async () => {
        fs.writeFileSync(path.join(repo.repoPath, stagedFile), `${repo.readFile(stagedFile)}// staged wip\n`);
        repo.exec(`git add ${stagedFile}`);
        fs.writeFileSync(path.join(repo.repoPath, unstagedFile), `${repo.readFile(unstagedFile)}\nunstaged wip\n`);
        fs.writeFileSync(path.join(repo.repoPath, untrackedFile), '{"wip":true}\n');

        await vscode.commands.executeCommand(commandId('copyWipChangesToWorktree'));

        assert.deepStrictEqual(errors.messages, []);
        // Target worktree received all three kinds of change.
        assert.ok(execIn(worktreePath, `git show :${stagedFile}`).includes('// staged wip'), 'staged change copied');
        assert.ok(
          fs.readFileSync(path.join(worktreePath, unstagedFile), 'utf-8').includes('unstaged wip'),
          'unstaged change copied'
        );
        assert.strictEqual(fs.existsSync(path.join(worktreePath, untrackedFile)), true, 'untracked file copied');
        // Source worktree still has its changes.
        assert.ok(repo.readFile(stagedFile).includes('// staged wip'), 'source staged change preserved');
        assert.strictEqual(repo.fileExists(untrackedFile), true, 'source untracked file preserved');
      });
    } finally {
      errors.restore();
      info.restore();
      restoreQuickPick();
      await cleanupWorktree(repo, worktreePath);
      repo.cleanup();
    }
  });
});
