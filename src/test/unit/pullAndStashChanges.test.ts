import * as assert from 'assert';

import { ConfigurationManager } from '../../configuration/configurationManager';
import { GitExecutor } from '../../common/git/gitExecutor';
import { AutoStashService } from '../../services/autoStashService';
import { mockLogService } from '../e2e/helpers/mockLogService';

function makeGitStub(overrides: Partial<GitExecutor> = {}): GitExecutor {
  return {
    isWorkdirHasChanges: async () => true,
    createStash: async () => {},
    hasUpstreamBranch: async () => true,
    pullFromRemoteBranch: async () => {},
    popStash: async () => {},
    resetLocalChanges: async () => {},
    ...overrides,
  } as unknown as GitExecutor;
}

describe('AutoStashService.pullAndStashChanges', () => {
  it('throws a clear "no upstream" error and never creates a stash when the branch has no upstream', async () => {
    const stashCalls: string[] = [];
    const git = makeGitStub({
      hasUpstreamBranch: async () => false,
      createStash: (async (msg: string) => {
        stashCalls.push(msg);
      }) as unknown as GitExecutor['createStash'],
    });

    const service = new AutoStashService({} as ConfigurationManager, mockLogService);

    await assert.rejects(
      () => service.pullAndStashChanges(git, 'feature-x', 'merge'),
      (err: Error) => {
        assert.match(err.message, /no upstream branch to pull from/);
        assert.match(err.message, /feature-x/);
        return true;
      }
    );

    assert.deepStrictEqual(stashCalls, []);
  });

  it('restores the stash before rethrowing when a pull fails and the working tree ends up clean', async () => {
    const popCalls: string[] = [];
    const git = makeGitStub({
      isWorkdirHasChanges: async () => true,
      pullFromRemoteBranch: async () => {
        throw new Error('There is no tracking information for the current branch');
      },
      popStash: (async (msg: string) => {
        popCalls.push(msg);
      }) as unknown as GitExecutor['popStash'],
    });

    // After the failed pull, isWorkdirHasChanges should report clean (nothing partially merged).
    let callCount = 0;
    git.isWorkdirHasChanges = (async () => {
      callCount += 1;
      // first call: before stash (dirty), second call: after failed pull (clean)
      return callCount === 1;
    }) as unknown as GitExecutor['isWorkdirHasChanges'];

    const service = new AutoStashService({} as ConfigurationManager, mockLogService);

    await assert.rejects(
      () => service.pullAndStashChanges(git, 'feature-x', 'merge'),
      (err: Error) => {
        assert.match(err.message, /Pull failed/);
        assert.doesNotMatch(err.message, /preserved in the stash/);
        return true;
      }
    );

    assert.strictEqual(popCalls.length, 1);
  });

  it('preserves the stash and keeps the original error message when a pull fails and the tree is left dirty (real conflict)', async () => {
    const popCalls: string[] = [];
    const git = makeGitStub({
      pullFromRemoteBranch: async () => {
        throw new Error('CONFLICT (content): Merge conflict in file.ts');
      },
      popStash: (async (msg: string) => {
        popCalls.push(msg);
      }) as unknown as GitExecutor['popStash'],
    });

    // Both before-stash and after-failed-pull checks report dirty (conflict markers left in tree).
    git.isWorkdirHasChanges = (async () => true) as unknown as GitExecutor['isWorkdirHasChanges'];

    const service = new AutoStashService({} as ConfigurationManager, mockLogService);

    await assert.rejects(
      () => service.pullAndStashChanges(git, 'feature-x', 'merge'),
      (err: Error) => {
        assert.match(err.message, /Pull failed/);
        assert.match(err.message, /preserved in the stash/);
        return true;
      }
    );

    assert.deepStrictEqual(popCalls, []);
  });
});
