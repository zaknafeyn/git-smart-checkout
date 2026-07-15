import * as assert from 'assert';
import * as vscode from 'vscode';

import { buildRefActionButtons } from '../../commands/checkoutToCommand/branchActionButtons';
import { CheckoutToCommand } from '../../commands/checkoutToCommand';
import { GitExecutor } from '../../common/git/gitExecutor';
import { IGitRef } from '../../common/git/types';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { AutoStashService } from '../../services/autoStashService';
import { mockLogService } from '../e2e/helpers/mockLogService';

const localRef: IGitRef = { name: 'feature-a', fullName: 'feature-a', authorName: '', isTag: false };
const currentRef: IGitRef = { name: 'main', fullName: 'main', authorName: '', isTag: false };
const remoteRef: IGitRef = {
  name: 'feature-a',
  fullName: 'origin/feature-a',
  authorName: '',
  isTag: false,
  remote: 'origin',
};
const tagRef: IGitRef = { name: 'v1.0.0', fullName: 'v1.0.0', authorName: '', isTag: true };
const upToDateLocalRef: IGitRef = {
  name: 'feature-b',
  fullName: 'feature-b',
  authorName: '',
  isTag: false,
  upstreamTrack: '[ahead 0]',
  parsedUpstreamTrack: [0, 0],
};

/** Exposes the protected action methods for direct unit testing. */
class TestableCheckoutToCommand extends CheckoutToCommand {
  infoMessages: string[] = [];

  constructor() {
    super({} as ConfigurationManager, mockLogService, {} as AutoStashService);
  }

  // Avoid popping a real (blocking) notification during tests — just record it.
  protected async showInformationMessage(message: string): Promise<string | undefined> {
    this.infoMessages.push(message);
    return undefined;
  }

  callHandleItemButtonAction(
    git: GitExecutor,
    repoId: string,
    currentBranch: string,
    branchList: IGitRef[],
    ref: IGitRef,
    action: 'star' | 'delete' | 'rename' | 'push'
  ) {
    return this.handleItemButtonAction(git, repoId, currentBranch, branchList, ref, action);
  }

  callRefreshBranchList(git: GitExecutor) {
    return this.refreshBranchList(git);
  }
}

function withStubbedDialog<T extends keyof typeof vscode.window>(
  method: T,
  stub: (typeof vscode.window)[T],
  fn: () => Promise<void>
): Promise<void> {
  const original = vscode.window[method];
  (vscode.window as any)[method] = stub;
  return fn().finally(() => {
    (vscode.window as any)[method] = original;
  });
}

describe('CheckoutToCommand inline actions — button assembly', () => {
  it('shows star + delete for a tag', () => {
    const buttons = buildRefActionButtons(tagRef, false);
    assert.deepStrictEqual(
      buttons.map((b) => b.action),
      ['star', 'delete']
    );
  });

  it('shows star + delete for a remote branch', () => {
    const buttons = buildRefActionButtons(remoteRef, false);
    assert.deepStrictEqual(
      buttons.map((b) => b.action),
      ['star', 'delete']
    );
  });

  it('shows star + delete + rename + push for a local branch with no upstream', () => {
    const buttons = buildRefActionButtons(localRef, false);
    assert.deepStrictEqual(
      buttons.map((b) => b.action),
      ['star', 'delete', 'rename', 'push']
    );
  });

  it('hides push for a local branch that is up to date with its upstream', () => {
    const buttons = buildRefActionButtons(upToDateLocalRef, false);
    assert.deepStrictEqual(
      buttons.map((b) => b.action),
      ['star', 'delete', 'rename']
    );
  });

  it('still shows delete/rename/push for the current branch (delete is blocked at action time)', () => {
    const buttons = buildRefActionButtons(currentRef, false);
    assert.deepStrictEqual(
      buttons.map((b) => b.action),
      ['star', 'delete', 'rename', 'push']
    );
  });
});

describe('CheckoutToCommand inline actions — delete decision matrix', () => {
  it('deletes a merged branch immediately with -d and no confirmation prompt', async () => {
    const calls: string[][] = [];
    const command = new TestableCheckoutToCommand();
    const git = {
      getDefaultBranch: async () => 'main',
      getMergedBranches: async () => ['main', 'feature-a'],
      deleteBranch: async (name: string, force: boolean) => {
        calls.push(['deleteBranch', name, String(force)]);
      },
      worktreeListDetailed: async () => [],
      repositoryPath: '/repo',
    } as unknown as GitExecutor;

    await withStubbedDialog('showWarningMessage', (async () => {
      throw new Error('should not prompt for a merged branch');
    }) as any, async () => {
      const mutated = await command.callHandleItemButtonAction(git, 'repo', 'main', [localRef], localRef, 'delete');
      assert.strictEqual(mutated, true);
    });

    assert.deepStrictEqual(calls, [['deleteBranch', 'feature-a', 'false']]);
  });

  it('deletes an unmerged branch with -D after confirmation', async () => {
    const calls: string[][] = [];
    const command = new TestableCheckoutToCommand();
    const git = {
      getDefaultBranch: async () => 'main',
      getMergedBranches: async () => ['main'],
      deleteBranch: async (name: string, force: boolean) => {
        calls.push(['deleteBranch', name, String(force)]);
      },
      worktreeListDetailed: async () => [],
      repositoryPath: '/repo',
    } as unknown as GitExecutor;

    await withStubbedDialog('showWarningMessage', (async () => 'Delete') as any, async () => {
      const mutated = await command.callHandleItemButtonAction(git, 'repo', 'main', [localRef], localRef, 'delete');
      assert.strictEqual(mutated, true);
    });

    assert.deepStrictEqual(calls, [['deleteBranch', 'feature-a', 'true']]);
  });

  it('does not call git when the unmerged-delete confirmation is dismissed', async () => {
    const calls: string[][] = [];
    const command = new TestableCheckoutToCommand();
    const git = {
      getDefaultBranch: async () => 'main',
      getMergedBranches: async () => ['main'],
      deleteBranch: async (name: string, force: boolean) => {
        calls.push(['deleteBranch', name, String(force)]);
      },
      worktreeListDetailed: async () => [],
      repositoryPath: '/repo',
    } as unknown as GitExecutor;

    await withStubbedDialog('showWarningMessage', (async () => undefined) as any, async () => {
      const mutated = await command.callHandleItemButtonAction(git, 'repo', 'main', [localRef], localRef, 'delete');
      assert.strictEqual(mutated, false);
    });

    assert.deepStrictEqual(calls, []);
  });

  it('blocks deleting the currently checked out branch without calling git', async () => {
    const calls: string[][] = [];
    const command = new TestableCheckoutToCommand();
    const git = {
      getDefaultBranch: async () => 'main',
      getMergedBranches: async () => ['main'],
      deleteBranch: async (name: string, force: boolean) => {
        calls.push(['deleteBranch', name, String(force)]);
      },
      worktreeListDetailed: async () => [],
      repositoryPath: '/repo',
    } as unknown as GitExecutor;

    let errorShown = false;
    await withStubbedDialog('showErrorMessage', (async () => {
      errorShown = true;
      return undefined;
    }) as any, async () => {
      const mutated = await command.callHandleItemButtonAction(git, 'repo', 'main', [currentRef], currentRef, 'delete');
      assert.strictEqual(mutated, false);
    });

    assert.deepStrictEqual(calls, []);
    assert.strictEqual(errorShown, true, 'an explanatory message should be shown');
  });

  it('surfaces the worktree-conflict flow instead of a raw git error when the branch is checked out elsewhere', async () => {
    const deleteCalls: string[] = [];
    const command = new TestableCheckoutToCommand();
    const git = {
      getDefaultBranch: async () => 'main',
      getMergedBranches: async () => ['main'],
      deleteBranch: async (name: string) => {
        deleteCalls.push(name);
      },
      worktreeListDetailed: async () => [
        { path: '/other/worktree', branch: 'refs/heads/feature-a', bare: false, prunable: false },
      ],
      repositoryPath: '/repo',
    } as unknown as GitExecutor;

    let infoMessageShown: string | undefined;
    await withStubbedDialog('showInformationMessage', (async (message: string) => {
      infoMessageShown = message;
      return undefined;
    }) as any, async () => {
      const mutated = await command.callHandleItemButtonAction(git, 'repo', 'main', [localRef], localRef, 'delete');
      assert.strictEqual(mutated, false);
    });

    assert.deepStrictEqual(deleteCalls, [], 'git should never be asked to delete a branch checked out elsewhere');
    assert.ok(infoMessageShown?.includes('/other/worktree'), 'worktree-conflict dialog should be shown');
  });
});

describe('CheckoutToCommand inline actions — rename validation', () => {
  it('rejects an invalid new branch name with the shared validator message and does not call git', async () => {
    const command = new TestableCheckoutToCommand();
    let renameCalled = false;
    const git = {
      renameBranch: async () => {
        renameCalled = true;
      },
    } as unknown as GitExecutor;

    const originalShowInputBox = vscode.window.showInputBox;
    (vscode.window as any).showInputBox = async (options: vscode.InputBoxOptions) => {
      const err = options.validateInput?.('invalid name with spaces');
      assert.ok(err, 'validateInput should reject a name containing whitespace');
      return undefined;
    };

    try {
      const mutated = await command.callHandleItemButtonAction(git, 'repo', 'main', [localRef], localRef, 'rename');
      assert.strictEqual(mutated, false);
    } finally {
      (vscode.window as any).showInputBox = originalShowInputBox;
    }

    assert.strictEqual(renameCalled, false);
  });

  it('renames the branch when a valid new name is provided', async () => {
    const command = new TestableCheckoutToCommand();
    const renameCalls: string[][] = [];
    const git = {
      renameBranch: async (oldName: string, newName: string) => {
        renameCalls.push([oldName, newName]);
      },
    } as unknown as GitExecutor;

    const originalShowInputBox = vscode.window.showInputBox;
    (vscode.window as any).showInputBox = async () => 'feature-a-renamed';

    try {
      const mutated = await command.callHandleItemButtonAction(git, 'repo', 'main', [localRef], localRef, 'rename');
      assert.strictEqual(mutated, true);
    } finally {
      (vscode.window as any).showInputBox = originalShowInputBox;
    }

    assert.deepStrictEqual(renameCalls, [['feature-a', 'feature-a-renamed']]);
  });
});

describe('CheckoutToCommand inline actions — remote branch delete confirmation', () => {
  it('names the remote in the confirmation prompt and deletes on confirm', async () => {
    const command = new TestableCheckoutToCommand();
    const deleteCalls: string[][] = [];
    const git = {
      deleteRemoteBranch: async (remote: string, name: string) => {
        deleteCalls.push([remote, name]);
      },
    } as unknown as GitExecutor;

    let promptMessage: string | undefined;
    await withStubbedDialog('showWarningMessage', (async (message: string) => {
      promptMessage = message;
      return 'Delete';
    }) as any, async () => {
      const mutated = await command.callHandleItemButtonAction(git, 'repo', 'main', [remoteRef], remoteRef, 'delete');
      assert.strictEqual(mutated, true);
    });

    assert.ok(promptMessage?.includes('origin'), 'confirmation should name the remote');
    assert.ok(promptMessage?.includes('feature-a'), 'confirmation should name the branch');
    assert.deepStrictEqual(deleteCalls, [['origin', 'feature-a']]);
  });

  it('is a silent no-op when the remote delete confirmation is dismissed', async () => {
    const command = new TestableCheckoutToCommand();
    const deleteCalls: string[][] = [];
    const git = {
      deleteRemoteBranch: async (remote: string, name: string) => {
        deleteCalls.push([remote, name]);
      },
    } as unknown as GitExecutor;

    let errorShown = false;
    await Promise.all([]);
    const originalShowErrorMessage = vscode.window.showErrorMessage;
    (vscode.window as any).showErrorMessage = async () => {
      errorShown = true;
      return undefined;
    };

    try {
      await withStubbedDialog('showWarningMessage', (async () => undefined) as any, async () => {
        const mutated = await command.callHandleItemButtonAction(git, 'repo', 'main', [remoteRef], remoteRef, 'delete');
        assert.strictEqual(mutated, false);
      });
    } finally {
      (vscode.window as any).showErrorMessage = originalShowErrorMessage;
    }

    assert.deepStrictEqual(deleteCalls, []);
    assert.strictEqual(errorShown, false, 'dismissal must not surface an error toast');
  });
});

describe('CheckoutToCommand inline actions — picker refresh', () => {
  it('re-fetches refs after a successful delete so the deleted branch is absent from the rebuilt list', async () => {
    const command = new TestableCheckoutToCommand();
    const git = {
      getAllRefListExtended: async () => [currentRef],
    } as unknown as GitExecutor;

    const refreshed = await command.callRefreshBranchList(git);
    assert.deepStrictEqual(
      refreshed.map((r) => r.name),
      ['main']
    );
  });
});
