import * as assert from 'assert';
import * as vscode from 'vscode';

import { CopyBranchNameCommand } from '../../commands/copyBranchNameCommand';
import { GitExecutor } from '../../common/git/gitExecutor';

import { createTestRepo } from './helpers/gitTestRepo';
import { mockLogService } from './helpers/mockLogService';

class TestableCopyBranchNameCommand extends CopyBranchNameCommand {
  constructor(private readonly git: GitExecutor) {
    super(mockLogService);
  }

  protected async getGitExecutor(): Promise<GitExecutor> {
    return this.git;
  }
}

function stubWithProgress(titles: string[]): () => void {
  const original = vscode.window.withProgress.bind(vscode.window);
  (vscode.window as any).withProgress = (
    options: vscode.ProgressOptions,
    task: (progress: unknown, token: unknown) => Thenable<unknown>
  ) => {
    if (options.title) {
      titles.push(options.title);
    }
    // Resolve the task immediately so the auto-dismiss timer does not linger.
    return Promise.resolve(task({ report: () => undefined }, { isCancellationRequested: false }));
  };
  return () => {
    (vscode.window as any).withProgress = original;
  };
}

function stubErrorMessages(messages: string[]): () => void {
  const original = vscode.window.showErrorMessage.bind(vscode.window);
  (vscode.window as any).showErrorMessage = async (message: string) => {
    messages.push(message);
    return 'OK';
  };
  return () => {
    (vscode.window as any).showErrorMessage = original;
  };
}

describe('CopyBranchNameCommand', () => {
  it('copies the current branch name to the clipboard and shows a notification', async () => {
    const repo = createTestRepo();
    repo.exec(`git checkout ${repo.featureBranch}`);

    const titles: string[] = [];
    const restoreWithProgress = stubWithProgress(titles);
    await vscode.env.clipboard.writeText('sentinel');

    try {
      await new TestableCopyBranchNameCommand(repo.git).execute();

      const clipboard = await vscode.env.clipboard.readText();
      assert.strictEqual(clipboard, repo.featureBranch);
      assert.strictEqual(titles.length, 1);
      assert.ok(
        titles[0].includes(repo.featureBranch),
        `expected notification title to include "${repo.featureBranch}", got "${titles[0]}"`
      );
    } finally {
      restoreWithProgress();
      repo.cleanup();
    }
  });

  it('shows an error and does not write the clipboard when no branch can be determined', async () => {
    const fakeGit = {
      getCurrentBranch: async () => '',
    } as unknown as GitExecutor;

    const messages: string[] = [];
    const restoreErrorMessages = stubErrorMessages(messages);
    await vscode.env.clipboard.writeText('sentinel');

    try {
      await new TestableCopyBranchNameCommand(fakeGit).execute();

      const clipboard = await vscode.env.clipboard.readText();
      assert.strictEqual(clipboard, 'sentinel');
      assert.strictEqual(messages.length, 1);
      assert.ok(messages[0].includes('not a git repository'));
    } finally {
      restoreErrorMessages();
    }
  });
});
