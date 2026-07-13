import * as assert from 'assert';

import { CheckoutPreviousCommand } from '../../commands/checkoutPreviousCommand';
import { GitExecutor } from '../../common/git/gitExecutor';
import { VscodeGitProvider } from '../../common/git/vscodeGitProvider';
import { AutoStashService } from '../../services/autoStashService';
import { mockLogService } from '../e2e/helpers/mockLogService';

class TestCheckoutPreviousCommand extends CheckoutPreviousCommand {
  infoMessages: string[] = [];

  protected override async getGitExecutor(_provider?: VscodeGitProvider): Promise<GitExecutor> {
    return {
      repositoryPath: '/repo',
      getCurrentBranch: async () => 'main',
      getPreviousBranch: async () => ({ name: 'feature-x', fullName: 'feature-x', remote: false, isTag: false }),
      worktreeListDetailed: async () => [],
    } as unknown as GitExecutor;
  }

  protected override async showInformationMessage(message: string): Promise<string | undefined> {
    this.infoMessages.push(message);
    return undefined;
  }
}

describe('CheckoutPreviousCommand cancellation', () => {
  it('does not show a success notification when the auto-stash checkout is cancelled', async () => {
    const autoStashService = {
      getAutoStashMode: async () => 'Auto stash and pop in new branch',
      checkoutAndStashChanges: async () => 'cancelled' as const,
    } as unknown as AutoStashService;

    const command = new TestCheckoutPreviousCommand(mockLogService, autoStashService);

    await command.execute();

    assert.deepStrictEqual(command.infoMessages, []);
  });

  it('shows the success notification when the checkout completes', async () => {
    const autoStashService = {
      getAutoStashMode: async () => 'Auto stash and pop in new branch',
      checkoutAndStashChanges: async () => 'completed' as const,
    } as unknown as AutoStashService;

    const command = new TestCheckoutPreviousCommand(mockLogService, autoStashService);

    await command.execute();

    assert.strictEqual(command.infoMessages.length, 1);
    assert.match(command.infoMessages[0], /Switched to previous branch: feature-x/);
  });
});
