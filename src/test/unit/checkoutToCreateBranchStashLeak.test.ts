import * as assert from 'assert';

import { CheckoutToCommand } from '../../commands/checkoutToCommand';
import { GitExecutor } from '../../common/git/gitExecutor';
import { VscodeGitProvider } from '../../common/git/vscodeGitProvider';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { AutoStashService } from '../../services/autoStashService';
import { IGitRef } from '../../common/git/types';
import { mockLogService } from '../e2e/helpers/mockLogService';

const baseRef: IGitRef = { name: 'main', fullName: 'main', authorName: '', isTag: false };

/** Command wrapper exposing constructor + git-executor stubbing for direct createNewBranchFrom calls. */
class StashLeakCommand extends CheckoutToCommand {
  popStashCalls: Array<{ stashName: string; apply?: boolean }> = [];

  constructor(
    private readonly popStashBehavior: 'succeed' | 'fail'
  ) {
    super({} as ConfigurationManager, mockLogService, {} as AutoStashService);
  }

  protected async getGitExecutor(_provider?: VscodeGitProvider): Promise<GitExecutor> {
    return {
      repositoryPath: '/repo',
      getRepoInfo: async () => undefined,
      isWorkdirHasChanges: async () => true,
      createStash: async (_stashName: string) => undefined,
      createBranch: async () => {
        throw new Error('base ref is invalid or duplicate');
      },
      popStash: async (stashName: string, apply?: boolean) => {
        this.popStashCalls.push({ stashName, apply });
        if (this.popStashBehavior === 'fail') {
          throw new Error('pop conflict');
        }
      },
    } as unknown as GitExecutor;
  }

  protected async pickBaseRef(): Promise<IGitRef | undefined> {
    return baseRef;
  }

  protected async showInputBox(): Promise<string | undefined> {
    return 'feature/new-branch';
  }
}

describe('CheckoutToCommand createNewBranchFrom stash handling on failure', () => {
  it('pops the stash created before a failing createBranch call', async () => {
    const command = new StashLeakCommand('succeed');
    const git = await command['getGitExecutor']();

    await assert.rejects(
      () => command.createNewBranchFrom(git, [baseRef]),
      (err: Error) => {
        assert.match(err.message, /Failed to create the new branch: base ref is invalid or duplicate/);
        assert.doesNotMatch(err.message, /preserved in stash/);
        return true;
      }
    );

    assert.strictEqual(command.popStashCalls.length, 1);
    assert.match(command.popStashCalls[0].stashName, /^smart-checkout-new-branch-\d+$/);
  });

  it('mentions the stash name in the error when the recovery pop also fails', async () => {
    const command = new StashLeakCommand('fail');
    const git = await command['getGitExecutor']();

    await assert.rejects(
      () => command.createNewBranchFrom(git, [baseRef]),
      (err: Error) => {
        assert.match(err.message, /Failed to create the new branch: base ref is invalid or duplicate/);
        assert.match(err.message, /Your changes are preserved in stash 'smart-checkout-new-branch-\d+'\./);
        return true;
      }
    );

    assert.strictEqual(command.popStashCalls.length, 1);
    assert.match(command.popStashCalls[0].stashName, /^smart-checkout-new-branch-\d+$/);
  });
});
