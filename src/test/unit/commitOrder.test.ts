import * as assert from 'assert';
import { CancellationToken } from 'vscode';

import { GitHubClient } from '../../common/api/ghClient';
import { GitExecutor } from '../../common/git/gitExecutor';
import { LoggingService } from '../../logging/loggingService';
import { PrCloneTempWorktreeService } from '../../services/prCloneTempWorktreeService';
import { orderSelectedCommits } from '../../utils/commitOrder';
import { CommitGeneratorItem, CommitsGenerator } from '../../utils/commitsGenerator';

async function collect(generator: CommitsGenerator): Promise<CommitGeneratorItem[]> {
  const items: CommitGeneratorItem[] = [];
  for await (const item of generator) {
    items.push(item);
  }
  return items;
}

describe('PR commit ordering', () => {
  it('filters selections using GitHub API order rather than selection order', () => {
    const apiCommits = [{ sha: 'parent' }, { sha: 'middle' }, { sha: 'child' }];

    assert.deepStrictEqual(orderSelectedCommits(apiCommits, ['child', 'parent']), [
      'parent',
      'child',
    ]);
  });

  it('preserves input order and progress for commits with identical timestamps', async () => {
    const commitsWithTheSameTimestamp = ['parent', 'middle', 'child'];

    assert.deepStrictEqual(await collect(new CommitsGenerator(commitsWithTheSameTimestamp)), [
      { sha: 'parent', current: 1, total: 3 },
      { sha: 'middle', current: 2, total: 3 },
      { sha: 'child', current: 3, total: 3 },
    ]);
  });

  it('passes selected commits to the temp-worktree cherry-pick in input order', async () => {
    const cherryPicks: Array<string | string[]> = [];
    const service = new PrCloneTempWorktreeService(
      {} as GitExecutor,
      {} as GitHubClient,
      { info: () => undefined } as unknown as LoggingService
    );
    const testableService = service as unknown as {
      tempGit: GitExecutor;
      cherryPickCommits(commitShas: string[], token: CancellationToken): Promise<void>;
    };
    testableService.tempGit = {
      cherryPick: async (commits: string | string[]) => {
        cherryPicks.push(commits);
      },
    } as GitExecutor;

    await testableService.cherryPickCommits(
      ['parent', 'middle', 'child'],
      { isCancellationRequested: false } as CancellationToken
    );

    assert.deepStrictEqual(cherryPicks, [['parent', 'middle', 'child']]);
  });
});
