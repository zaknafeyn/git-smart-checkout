import * as assert from 'assert';

import { CheckoutPreviousCommand } from '../../commands/checkoutPreviousCommand';
import { GitExecutor } from '../../common/git/gitExecutor';
import { VscodeGitProvider } from '../../common/git/vscodeGitProvider';
import { AutoStashService } from '../../services/autoStashService';
import { mockLogService } from '../e2e/helpers/mockLogService';

class TestCheckoutPreviousCommand extends CheckoutPreviousCommand {
  constructor(
    private isDirty: boolean,
    autoStashService: AutoStashService
  ) {
    super(mockLogService, autoStashService);
  }

  protected override async getGitExecutor(_provider?: VscodeGitProvider): Promise<GitExecutor> {
    return {
      repositoryPath: '/repo',
      getCurrentBranch: async () => 'main',
      getPreviousBranch: async () => ({ name: 'feature-x', fullName: 'feature-x', remote: false, isTag: false }),
      worktreeListDetailed: async () => [],
      isWorkdirHasChanges: async () => this.isDirty,
    } as unknown as GitExecutor;
  }

  protected override async showInformationMessage(_message: string): Promise<string | undefined> {
    return undefined;
  }
}

describe('CheckoutPreviousCommand skip stash prompt on clean tree', () => {
  it('does not call getAutoStashMode when the working tree is clean', async () => {
    let called = false;
    const autoStashService = {
      getAutoStashMode: async () => {
        called = true;
        return 'Auto stash and pop in new branch';
      },
      checkoutAndStashChanges: async () => 'completed' as const,
    } as unknown as AutoStashService;

    const command = new TestCheckoutPreviousCommand(false, autoStashService);
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

    const command = new TestCheckoutPreviousCommand(true, autoStashService);
    await command.execute();

    assert.strictEqual(called, true, 'getAutoStashMode should still be called for a dirty tree');
  });
});
