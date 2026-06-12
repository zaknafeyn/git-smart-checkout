import * as assert from 'assert';

import { CheckoutToCommand } from '../../commands/checkoutToCommand';
import { GitExecutor } from '../../common/git/gitExecutor';
import { VscodeGitProvider } from '../../common/git/vscodeGitProvider';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { LoggingService } from '../../logging/loggingService';
import { AutoStashService } from '../../services/autoStashService';
import { IGitRef } from '../../common/git/types';

class DismissedCheckoutToCommand extends CheckoutToCommand {
  targetBranchRequested = false;

  protected async getGitExecutor(_provider?: VscodeGitProvider): Promise<GitExecutor> {
    return {} as GitExecutor;
  }

  async getSelectedOption(): Promise<undefined> {
    return undefined;
  }

  async getTargetBranch(
    _git: GitExecutor,
    _selection: string,
    _branchList: IGitRef[]
  ): Promise<IGitRef> {
    this.targetBranchRequested = true;
    throw new Error('Target branch should not be requested after dismissal.');
  }
}

describe('CheckoutToCommand dismissal', () => {
  it('returns without treating picker dismissal as an error', async () => {
    const command = new DismissedCheckoutToCommand(
      {} as ConfigurationManager,
      {} as LoggingService,
      {} as AutoStashService
    );

    await command.execute();

    assert.strictEqual(command.targetBranchRequested, false);
  });
});
