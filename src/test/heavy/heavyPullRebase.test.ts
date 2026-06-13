import * as assert from 'assert';

import {
  AUTO_STASH_CURRENT_BRANCH,
} from '../../commands/checkoutToCommand/constants';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { AutoStashService } from '../../services/autoStashService';

import { createHeavyTestRepo, HeavyTestRepo } from '../e2e/helpers/gitTestRepo';
import { mockLogService } from '../e2e/helpers/mockLogService';

/**
 * Heavy-repository coverage for pull-with-stash and rebase-with-stash. The
 * repo's local `main` is behind a producer that pushed commits touching several
 * files; every operation runs while the working tree carries a full mixed-state
 * WIP that is disjoint from both the remote and the rebase target.
 */

const mockConfigManager = {
  get: () => ({ useFastBranchList: false }),
} as unknown as ConfigurationManager;
const sut = new AutoStashService(mockConfigManager, mockLogService);

function assertHeadContains(repo: HeavyTestRepo, target: string): void {
  assert.doesNotThrow(
    () => repo.exec(`git merge-base --is-ancestor ${target} HEAD`),
    `HEAD should contain ${target}`
  );
}

describe('Heavy repo — pull with stash (merge)', () => {
  let repo: HeavyTestRepo;
  before(() => { repo = createHeavyTestRepo(); });
  after(() => { repo.cleanup(); });

  it('integrates remote commits and restores the full WIP', async () => {
    const state = repo.seedComplexWorkingState();

    await sut.pullAndStashChanges(repo.git, repo.mainBranch, 'merge');

    assert.strictEqual(repo.stashCount(), 0, 'temporary stash is popped');
    // Remote (producer) changes are present.
    assert.ok(repo.readFile('data/orders.json').includes('101'), 'remote order integrated');
    assert.strictEqual(repo.fileExists('docs/CHANGELOG.md'), true, 'remote-added file present');
    // Local WIP is restored.
    assert.ok(repo.readFile(state.staged[0]).includes('// staged edit'), 'staged WIP restored');
    assert.ok(repo.readFile(state.modifiedUnstaged[0]).includes('// unstaged edit'), 'unstaged WIP restored');
    assert.strictEqual(repo.fileExists(state.untracked[0]), true, 'untracked WIP restored');
    assert.strictEqual(repo.fileExists(state.deleted[0]), false, 'deletion restored');
  });
});

describe('Heavy repo — pull with stash (rebase)', () => {
  let repo: HeavyTestRepo;
  before(() => { repo = createHeavyTestRepo(); });
  after(() => { repo.cleanup(); });

  it('replays a local commit on top of the remote and restores the WIP', async () => {
    // Give local main a commit the remote does not have, so the pull truly rebases.
    repo.makeChange('docs/local-note.md', '# Local note\n\nadded locally\n');
    repo.exec('git add docs/local-note.md');
    repo.exec('git commit -m "docs: local note"');

    const state = repo.seedComplexWorkingState();

    await sut.pullAndStashChanges(repo.git, repo.mainBranch, 'rebase');

    assert.strictEqual(repo.stashCount(), 0);
    assert.strictEqual(repo.fileExists('docs/local-note.md'), true, 'local commit preserved');
    assert.ok(repo.readFile('data/orders.json').includes('101'), 'remote order integrated');
    assert.strictEqual(repo.fileExists('docs/CHANGELOG.md'), true, 'remote-added file present');
    // Linear history: the local commit sits on top of the remote commit.
    assertHeadContains(repo, 'origin/main');
    assert.ok(repo.readFile(state.staged[1]).includes('// staged edit'), 'WIP restored after rebase');
  });
});

describe('Heavy repo — rebase with stash (branch onto branch)', () => {
  let repo: HeavyTestRepo;
  before(() => { repo = createHeavyTestRepo(); });
  after(() => { repo.cleanup(); });

  it('rebases a feature branch onto a release branch and restores the WIP', async () => {
    repo.exec(`git checkout ${repo.apiBranch}`);
    const state = repo.seedComplexWorkingState();

    await sut.rebaseAndStashChanges(repo.git, repo.apiBranch, repo.releaseBranch, AUTO_STASH_CURRENT_BRANCH);

    assert.strictEqual(await repo.git.getCurrentBranch(), repo.apiBranch);
    assertHeadContains(repo, repo.releaseBranch);
    assert.strictEqual(repo.stashCount(), 0);
    // Both branches' committed changes are present after the rebase.
    assert.ok(repo.readFile('src/services/apiService.ts').includes('api:v2'), 'feature commit kept');
    assert.strictEqual(repo.fileExists('src/services/webhookService.ts'), true, 'feature file kept');
    assert.ok(repo.readFile('package.json').includes('1.1.0'), 'release commit incorporated');
    // WIP restored.
    assert.ok(repo.readFile(state.staged[0]).includes('// staged edit'), 'WIP restored after rebase');
    assert.strictEqual(repo.fileExists(state.untracked[0]), true, 'untracked WIP restored');
  });
});
