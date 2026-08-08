import * as assert from 'assert';

import { CheckoutBranchCommand } from '../../commands/checkoutBranchCommand';
import { GitExecutor } from '../../common/git/gitExecutor';
import { IGitRef } from '../../common/git/types';
import { VscodeGitProvider } from '../../common/git/vscodeGitProvider';
import { AutoStashService } from '../../services/autoStashService';
import { mockLogService } from '../e2e/helpers/mockLogService';

const localRef: IGitRef = { name: 'feature-x', fullName: 'feature-x', authorName: '', remote: undefined, isTag: false };
const remoteOnlyRef: IGitRef = { name: 'feature-y', fullName: 'origin/feature-y', authorName: '', remote: 'origin', isTag: false };

class TestCheckoutBranchCommand extends CheckoutBranchCommand {
  infoMessages: string[] = [];
  errorMessages: string[] = [];

  constructor(
    private refs: IGitRef[],
    private isDirty: boolean,
    autoStashService: AutoStashService,
    private currentBranch = 'main'
  ) {
    super(mockLogService, autoStashService);
  }

  protected override async getGitExecutor(_provider?: VscodeGitProvider): Promise<GitExecutor> {
    return {
      repositoryPath: '/repo',
      getCurrentBranch: async () => this.currentBranch,
      getAllRefListExtended: async () => this.refs,
      worktreeListDetailed: async () => [],
      isWorkdirHasChanges: async () => this.isDirty,
    } as unknown as GitExecutor;
  }

  protected override async showInformationMessage(message: string): Promise<string | undefined> {
    this.infoMessages.push(message);
    return undefined;
  }

  protected override async showErrorMessage(message: string): Promise<string | undefined> {
    this.errorMessages.push(message);
    return undefined;
  }
}

function makeAutoStashService(checkoutRefs: IGitRef[] = []): AutoStashService {
  return {
    getAutoStashMode: async () => 'Auto stash and pop in new branch',
    checkoutAndStashChanges: async (_git: unknown, _current: string, ref: IGitRef) => {
      checkoutRefs.push(ref);
      return 'completed' as const;
    },
  } as unknown as AutoStashService;
}

describe('CheckoutBranchCommand', () => {
  it('checks out a local branch by name using a plain string argument', async () => {
    const checkoutRefs: IGitRef[] = [];
    const command = new TestCheckoutBranchCommand([localRef], false, makeAutoStashService(checkoutRefs));

    await command.execute('feature-x');

    assert.deepStrictEqual(checkoutRefs, [localRef]);
  });

  it('resolves a remote-only branch into a tracking ref carrying the remote', async () => {
    const checkoutRefs: IGitRef[] = [];
    const command = new TestCheckoutBranchCommand([remoteOnlyRef], false, makeAutoStashService(checkoutRefs));

    await command.execute({ branch: 'feature-y' });

    assert.strictEqual(checkoutRefs.length, 1);
    assert.strictEqual(checkoutRefs[0].remote, 'origin');
    assert.strictEqual(checkoutRefs[0].fullName, 'origin/feature-y');
  });

  it('is a no-op when already on the requested branch', async () => {
    const checkoutRefs: IGitRef[] = [];
    const command = new TestCheckoutBranchCommand([localRef], false, makeAutoStashService(checkoutRefs), 'feature-x');

    await command.execute('feature-x');

    assert.deepStrictEqual(checkoutRefs, []);
    assert.strictEqual(command.infoMessages.length, 1);
    assert.match(command.infoMessages[0], /Already on branch/);
  });

  it('skips the stash prompt on a clean tree', async () => {
    let getAutoStashModeCalled = false;
    const autoStashService = {
      getAutoStashMode: async () => {
        getAutoStashModeCalled = true;
        return 'Auto stash and pop in new branch';
      },
      checkoutAndStashChanges: async () => 'completed' as const,
    } as unknown as AutoStashService;

    const command = new TestCheckoutBranchCommand([localRef], false, autoStashService);
    await command.execute('feature-x');

    assert.strictEqual(getAutoStashModeCalled, false);
  });

  it('aborts without checking out when getAutoStashMode is dismissed', async () => {
    const checkoutRefs: IGitRef[] = [];
    const autoStashService = {
      getAutoStashMode: async () => undefined,
      checkoutAndStashChanges: async (_git: unknown, _current: string, ref: IGitRef) => {
        checkoutRefs.push(ref);
        return 'completed' as const;
      },
    } as unknown as AutoStashService;

    const command = new TestCheckoutBranchCommand([localRef], true, autoStashService);
    await command.execute('feature-x');

    assert.deepStrictEqual(checkoutRefs, []);
  });

  it('surfaces an error when the branch cannot be found locally or remotely', async () => {
    const command = new TestCheckoutBranchCommand([], false, makeAutoStashService());
    await command.execute('does-not-exist');

    assert.strictEqual(command.errorMessages.length, 1);
    assert.match(command.errorMessages[0], /was not found/);
  });
});
