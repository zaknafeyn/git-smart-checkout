import * as assert from 'assert';

import {
  CheckoutToCommand,
  LABEL_CREATE_NEW_BRANCH,
  LABEL_CREATE_NEW_BRANCH_FROM,
} from '../../commands/checkoutToCommand';
import { GitExecutor } from '../../common/git/gitExecutor';
import { VscodeGitProvider } from '../../common/git/vscodeGitProvider';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { AutoStashService } from '../../services/autoStashService';
import { IGitRef } from '../../common/git/types';
import { mockLogService } from '../e2e/helpers/mockLogService';

const baseRef: IGitRef = { name: 'main', fullName: 'main', authorName: '', isTag: false };

/** Escape pressed at the "Create new branch..." name prompt. */
class EscapeAtBranchNameCommand extends CheckoutToCommand {
  createBranchCalled = false;
  errorShown = false;

  constructor(autoStashService: AutoStashService) {
    super({} as ConfigurationManager, mockLogService, autoStashService);
  }

  protected async getGitExecutor(_provider?: VscodeGitProvider): Promise<GitExecutor> {
    return {
      repositoryPath: '/repo',
      getCurrentBranch: async () => 'main',
      worktreeListDetailed: async () => [],
      createBranch: async () => {
        this.createBranchCalled = true;
        return baseRef;
      },
    } as unknown as GitExecutor;
  }

  async getSelectedOption() {
    return {
      currentBranch: 'main',
      selection: LABEL_CREATE_NEW_BRANCH,
      branchList: [] as IGitRef[],
    };
  }

  protected async showInputBox(): Promise<string | undefined> {
    // Simulate the user pressing Escape.
    return undefined;
  }

  protected async showErrorMessage(message: string, ...items: string[]): Promise<string | undefined> {
    this.errorShown = true;
    return undefined;
  }
}

/** Escape pressed at the base-ref picker of "Create new branch from...". */
class EscapeAtBaseRefCommand extends CheckoutToCommand {
  createBranchCalled = false;
  errorShown = false;

  constructor(autoStashService: AutoStashService) {
    super({} as ConfigurationManager, mockLogService, autoStashService);
  }

  protected async getGitExecutor(_provider?: VscodeGitProvider): Promise<GitExecutor> {
    return {
      repositoryPath: '/repo',
      getCurrentBranch: async () => 'main',
      getRepoInfo: async () => undefined,
      worktreeListDetailed: async () => [],
      createBranch: async () => {
        this.createBranchCalled = true;
        return baseRef;
      },
    } as unknown as GitExecutor;
  }

  async getSelectedOption() {
    return {
      currentBranch: 'main',
      selection: LABEL_CREATE_NEW_BRANCH_FROM,
      branchList: [baseRef],
    };
  }

  protected async pickBaseRef(): Promise<IGitRef | undefined> {
    // Simulate the user dismissing the base-ref quick pick.
    return undefined;
  }

  protected async showErrorMessage(message: string, ...items: string[]): Promise<string | undefined> {
    this.errorShown = true;
    return undefined;
  }
}

/** Escape pressed at the branch-name prompt of "Create new branch from...", after a base ref was picked. */
class EscapeAtBranchNameFromCommand extends CheckoutToCommand {
  createBranchCalled = false;
  errorShown = false;

  constructor(autoStashService: AutoStashService) {
    super({} as ConfigurationManager, mockLogService, autoStashService);
  }

  protected async getGitExecutor(_provider?: VscodeGitProvider): Promise<GitExecutor> {
    return {
      repositoryPath: '/repo',
      getCurrentBranch: async () => 'main',
      getRepoInfo: async () => undefined,
      worktreeListDetailed: async () => [],
      createBranch: async () => {
        this.createBranchCalled = true;
        return baseRef;
      },
    } as unknown as GitExecutor;
  }

  async getSelectedOption() {
    return {
      currentBranch: 'main',
      selection: LABEL_CREATE_NEW_BRANCH_FROM,
      branchList: [baseRef],
    };
  }

  protected async pickBaseRef(): Promise<IGitRef | undefined> {
    return baseRef;
  }

  protected async showInputBox(): Promise<string | undefined> {
    return undefined;
  }

  protected async showErrorMessage(message: string, ...items: string[]): Promise<string | undefined> {
    this.errorShown = true;
    return undefined;
  }
}

describe('CheckoutToCommand user-cancellation (create branch flows)', () => {
  it('does not error when Escape is pressed at "Create new branch..."', async () => {
    const command = new EscapeAtBranchNameCommand({} as AutoStashService);

    await command.execute();

    assert.strictEqual(command.createBranchCalled, false);
    assert.strictEqual(command.errorShown, false);
  });

  it('does not error when the base-ref picker is dismissed in "Create new branch from..."', async () => {
    const command = new EscapeAtBaseRefCommand({} as AutoStashService);

    await command.execute();

    assert.strictEqual(command.createBranchCalled, false);
    assert.strictEqual(command.errorShown, false);
  });

  it('does not error when Escape is pressed at the name prompt in "Create new branch from..."', async () => {
    const command = new EscapeAtBranchNameFromCommand({} as AutoStashService);

    await command.execute();

    assert.strictEqual(command.createBranchCalled, false);
    assert.strictEqual(command.errorShown, false);
  });
});
