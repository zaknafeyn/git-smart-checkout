import * as assert from 'assert';

import { FetchBranchCommand } from '../../commands/fetchBranchCommand';
import { GitExecutor } from '../../common/git/gitExecutor';
import { VscodeGitProvider } from '../../common/git/vscodeGitProvider';
import { mockLogService } from '../e2e/helpers/mockLogService';

interface GitStubOptions {
  upstreamRemote?: string;
  fetchError?: Error;
}

class TestFetchBranchCommand extends FetchBranchCommand {
  errorMessages: string[] = [];
  fetchCalls: Array<[string, string]> = [];

  constructor(private options: GitStubOptions = {}) {
    super(mockLogService);
  }

  protected override async getGitExecutor(_provider?: VscodeGitProvider): Promise<GitExecutor> {
    return {
      repositoryPath: '/repo',
      getUpstreamRemote: async () => this.options.upstreamRemote,
      fetchSpecificBranch: async (branch: string, remote: string) => {
        if (this.options.fetchError) {
          throw this.options.fetchError;
        }
        this.fetchCalls.push([branch, remote]);
      },
    } as unknown as GitExecutor;
  }

  protected override async showErrorMessage(message: string): Promise<string | undefined> {
    this.errorMessages.push(message);
    return undefined;
  }
}

describe('FetchBranchCommand', () => {
  it('fetches the branch from its configured upstream remote when one exists', async () => {
    const command = new TestFetchBranchCommand({ upstreamRemote: 'upstream' });

    await command.execute('release/1.0');

    assert.deepStrictEqual(command.fetchCalls, [['release/1.0', 'upstream']]);
  });

  it('defaults to "origin" when the branch has no configured upstream', async () => {
    const command = new TestFetchBranchCommand({ upstreamRemote: undefined });

    await command.execute('release/1.0');

    assert.deepStrictEqual(command.fetchCalls, [['release/1.0', 'origin']]);
  });

  it('uses an explicitly-provided remote over the detected upstream', async () => {
    const command = new TestFetchBranchCommand({ upstreamRemote: 'upstream' });

    await command.execute({ branch: 'release/1.0', remote: 'fork' });

    assert.deepStrictEqual(command.fetchCalls, [['release/1.0', 'fork']]);
  });

  it('surfaces an error when the fetch fails, without throwing', async () => {
    const command = new TestFetchBranchCommand({ fetchError: new Error('could not resolve host') });

    await command.execute('release/1.0');

    assert.strictEqual(command.errorMessages.length, 1);
    assert.match(command.errorMessages[0], /Failed to fetch "release\/1\.0"/);
  });
});
