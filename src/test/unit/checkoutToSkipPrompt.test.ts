import * as assert from 'assert';

import { CheckoutToCommand } from '../../commands/checkoutToCommand';
import { GitExecutor } from '../../common/git/gitExecutor';
import { VscodeGitProvider } from '../../common/git/vscodeGitProvider';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { IGitRef } from '../../common/git/types';
import { AutoStashService } from '../../services/autoStashService';
import { mockLogService } from '../e2e/helpers/mockLogService';

const targetRef: IGitRef = { name: 'feature-x', fullName: 'feature-x', authorName: '', isTag: false };

class TestCheckoutToCommand extends CheckoutToCommand {
  checkoutCalled = false;

  constructor(
    private isDirty: boolean,
    autoStashService: AutoStashService
  ) {
    super({} as ConfigurationManager, mockLogService, autoStashService);
  }

  protected async getGitExecutor(_provider?: VscodeGitProvider): Promise<GitExecutor> {
    return {
      repositoryPath: '/repo',
      getCurrentBranch: async () => 'main',
      worktreeListDetailed: async () => [],
      isWorkdirHasChanges: async () => this.isDirty,
    } as unknown as GitExecutor;
  }

  async getSelectedOption() {
    return {
      currentBranch: 'main',
      selection: 'feature-x',
      selectedRef: targetRef,
      branchList: [targetRef],
    };
  }
}

describe('CheckoutToCommand skip stash prompt on clean tree', () => {
  it('does not call getAutoStashMode when the working tree is clean', async () => {
    let called = false;
    const autoStashService = {
      getAutoStashMode: async () => {
        called = true;
        return 'Auto stash and pop in new branch';
      },
      checkoutAndStashChanges: async () => 'completed' as const,
    } as unknown as AutoStashService;

    const command = new TestCheckoutToCommand(false, autoStashService);
    await command.execute();

    assert.strictEqual(called, false, 'getAutoStashMode should be skipped for a clean tree');
  });

  it('still prompts via getAutoStashMode when the working tree is dirty', async () => {
    let called = false;
    const autoStashService = {
      getAutoStashMode: async () => {
        called = true;
        return 'Auto stash and pop in new branch';
      },
      checkoutAndStashChanges: async () => 'completed' as const,
    } as unknown as AutoStashService;

    const command = new TestCheckoutToCommand(true, autoStashService);
    await command.execute();

    assert.strictEqual(called, true, 'getAutoStashMode should still be called for a dirty tree');
  });

  it('cancels the checkout when the dirty-tree prompt is dismissed', async () => {
    let checkoutCalled = false;
    const autoStashService = {
      getAutoStashMode: async () => undefined,
      checkoutAndStashChanges: async () => {
        checkoutCalled = true;
        return 'completed' as const;
      },
    } as unknown as AutoStashService;

    const command = new TestCheckoutToCommand(true, autoStashService);
    await command.execute();

    assert.strictEqual(checkoutCalled, false, 'checkout should not proceed when the prompt is dismissed');
  });
});
