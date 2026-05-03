import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import {
  AUTO_STASH_CURRENT_BRANCH,
  AUTO_STASH_IGNORE,
} from '../../commands/checkoutToCommand/constants';
import { RebaseWithStashCommand } from '../../commands/rebaseWithStashCommand';
import { GitExecutor } from '../../common/git/gitExecutor';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { AutoStashService } from '../../services/autoStashService';

import {
  createRebaseConflictTestRepo,
  createRebaseTestRepo,
  TestRepo,
} from './helpers/gitTestRepo';
import { mockLogService } from './helpers/mockLogService';

const mockConfigManager = {} as unknown as ConfigurationManager;
const sut = new AutoStashService(mockConfigManager, mockLogService);

function assertHeadContains(repo: TestRepo, target: string): void {
  assert.doesNotThrow(
    () => repo.exec(`git merge-base --is-ancestor ${target} HEAD`),
    `HEAD should contain ${target}`
  );
}

function assertRebaseInProgress(repo: TestRepo): void {
  assert.ok(
    repo.fileExists('.git/rebase-merge') || repo.fileExists('.git/rebase-apply'),
    'rebase state should be left for the user to resolve'
  );
}

function stubQuickPick(
  pick: (items: readonly vscode.QuickPickItem[]) => vscode.QuickPickItem | undefined
): () => void {
  const original = vscode.window.showQuickPick.bind(vscode.window);
  (vscode.window as any).showQuickPick = async (items: readonly vscode.QuickPickItem[]) => pick(items);
  return () => { (vscode.window as any).showQuickPick = original; };
}

function stubErrorMessages(messages: string[]): () => void {
  const original = vscode.window.showErrorMessage.bind(vscode.window);
  (vscode.window as any).showErrorMessage = async (message: string) => {
    messages.push(message);
    return 'OK';
  };
  return () => { (vscode.window as any).showErrorMessage = original; };
}

class TestableRebaseWithStashCommand extends RebaseWithStashCommand {
  constructor(
    private readonly git: GitExecutor,
    autoStashService: AutoStashService
  ) {
    super(mockConfigManager, mockLogService, autoStashService);
  }

  protected async getGitExecutor(): Promise<GitExecutor> {
    return this.git;
  }
}

describe('AutoStashService - rebaseAndStashChanges', () => {

  describe('AUTO_STASH_CURRENT_BRANCH: clean working tree', () => {
    let repo: TestRepo;
    before(() => { repo = createRebaseTestRepo(); });
    after(() => { repo.cleanup(); });

    it('rebases onto a local branch without creating a stash', async () => {
      await sut.rebaseAndStashChanges(repo.git, repo.featureBranch, repo.mainBranch, AUTO_STASH_CURRENT_BRANCH);

      assert.strictEqual(await repo.git.getCurrentBranch(), repo.featureBranch);
      assertHeadContains(repo, repo.mainBranch);
      assert.strictEqual(await repo.git.isWorkdirHasChanges(), false);
      assert.strictEqual(repo.stashCount(), 0);
      assert.strictEqual(repo.fileExists('main.txt'), true, 'rebased branch should include target branch files');
      assert.strictEqual(repo.fileExists('feature.txt'), true, 'rebased branch should keep feature files');
    });
  });

  describe('AUTO_STASH_CURRENT_BRANCH: tracked changes', () => {
    let repo: TestRepo;
    before(() => { repo = createRebaseTestRepo(); });
    after(() => { repo.cleanup(); });

    it('stashes, rebases, pops, and restores tracked working tree changes', async () => {
      repo.makeChange('file1.txt', 'tracked work in progress\n');

      await sut.rebaseAndStashChanges(repo.git, repo.featureBranch, repo.mainBranch, AUTO_STASH_CURRENT_BRANCH);

      assert.strictEqual(await repo.git.getCurrentBranch(), repo.featureBranch);
      assertHeadContains(repo, repo.mainBranch);
      assert.strictEqual(repo.readFile('file1.txt'), 'tracked work in progress\n');
      assert.strictEqual(await repo.git.isWorkdirHasChanges(), true, 'tracked change should be restored');
      assert.strictEqual(repo.stashCount(), 0, 'stash should be removed after a successful pop');
    });
  });

  describe('AUTO_STASH_CURRENT_BRANCH: untracked changes', () => {
    let repo: TestRepo;
    before(() => { repo = createRebaseTestRepo(); });
    after(() => { repo.cleanup(); });

    it('includes untracked files in the temporary stash and restores them after rebase', async () => {
      repo.makeChange('notes.txt', 'untracked work in progress\n');

      await sut.rebaseAndStashChanges(repo.git, repo.featureBranch, repo.mainBranch, AUTO_STASH_CURRENT_BRANCH);

      assert.strictEqual(await repo.git.getCurrentBranch(), repo.featureBranch);
      assertHeadContains(repo, repo.mainBranch);
      assert.strictEqual(repo.readFile('notes.txt'), 'untracked work in progress\n');
      assert.strictEqual(await repo.git.isWorkdirHasChanges(), true, 'untracked change should be restored');
      assert.strictEqual(repo.stashCount(), 0);
    });
  });

  describe('AUTO_STASH_CURRENT_BRANCH: dirty state produced during rebase', () => {
    let repo: TestRepo;
    before(() => { repo = createRebaseTestRepo(); });
    after(() => { repo.cleanup(); });

    it('resets tracked changes created by a successful rebase before popping the stash', async () => {
      repo.makeChange('file1.txt', 'tracked work in progress\n');

      const hookPath = path.join(repo.repoPath, '.git', 'hooks', 'post-rewrite');
      fs.writeFileSync(hookPath, '#!/bin/sh\nprintf "hook dirtied main\\n" > main.txt\n');
      fs.chmodSync(hookPath, 0o755);

      await sut.rebaseAndStashChanges(repo.git, repo.featureBranch, repo.mainBranch, AUTO_STASH_CURRENT_BRANCH);

      assertHeadContains(repo, repo.mainBranch);
      assert.strictEqual(repo.readFile('main.txt'), 'main content\n', 'hook change should be discarded');
      assert.strictEqual(repo.readFile('file1.txt'), 'tracked work in progress\n', 'original stash should be restored');
      assert.strictEqual(repo.stashCount(), 0);
    });
  });

  describe('AUTO_STASH_IGNORE: clean working tree', () => {
    let repo: TestRepo;
    before(() => { repo = createRebaseTestRepo(); });
    after(() => { repo.cleanup(); });

    it('rebases without touching the stash list', async () => {
      await sut.rebaseAndStashChanges(repo.git, repo.featureBranch, repo.mainBranch, AUTO_STASH_IGNORE);

      assert.strictEqual(await repo.git.getCurrentBranch(), repo.featureBranch);
      assertHeadContains(repo, repo.mainBranch);
      assert.strictEqual(await repo.git.isWorkdirHasChanges(), false);
      assert.strictEqual(repo.stashCount(), 0);
    });
  });

  describe('AUTO_STASH_IGNORE: non-blocking untracked changes', () => {
    let repo: TestRepo;
    before(() => { repo = createRebaseTestRepo(); });
    after(() => { repo.cleanup(); });

    it('rebases and leaves untracked files untouched without creating a stash', async () => {
      repo.makeChange('scratch.txt', 'untracked scratch\n');

      await sut.rebaseAndStashChanges(repo.git, repo.featureBranch, repo.mainBranch, AUTO_STASH_IGNORE);

      assert.strictEqual(await repo.git.getCurrentBranch(), repo.featureBranch);
      assertHeadContains(repo, repo.mainBranch);
      assert.strictEqual(repo.readFile('scratch.txt'), 'untracked scratch\n');
      assert.strictEqual(repo.stashCount(), 0);
    });
  });

  describe('AUTO_STASH_IGNORE: blocking tracked changes', () => {
    let repo: TestRepo;
    before(() => { repo = createRebaseTestRepo(); });
    after(() => { repo.cleanup(); });

    it('lets git reject the rebase and preserves the working tree without creating a stash', async () => {
      repo.makeChange('file1.txt', 'tracked work in progress\n');

      await assert.rejects(
        () => sut.rebaseAndStashChanges(repo.git, repo.featureBranch, repo.mainBranch, AUTO_STASH_IGNORE),
        /unstaged changes|local changes/i
      );

      assert.strictEqual(await repo.git.getCurrentBranch(), repo.featureBranch);
      assert.strictEqual(repo.readFile('file1.txt'), 'tracked work in progress\n');
      assert.strictEqual(repo.stashCount(), 0);
      assert.throws(() => repo.exec(`git merge-base --is-ancestor ${repo.mainBranch} HEAD`));
    });
  });

  describe('AUTO_STASH_CURRENT_BRANCH: rebase conflict with clean working tree', () => {
    let repo: TestRepo;
    before(() => { repo = createRebaseConflictTestRepo(); });
    after(() => { repo.cleanup(); });

    it('throws a rebase error, leaves conflict state in place, and does not create a stash', async () => {
      await assert.rejects(
        () => sut.rebaseAndStashChanges(repo.git, repo.featureBranch, repo.mainBranch, AUTO_STASH_CURRENT_BRANCH),
        /Rebase failed:/
      );

      assertRebaseInProgress(repo);
      assert.strictEqual(await repo.git.isWorkdirHasChanges(), true, 'conflicts should leave the worktree dirty');
      assert.strictEqual(repo.stashCount(), 0);
    });
  });

  describe('AUTO_STASH_CURRENT_BRANCH: rebase conflict after stashing local changes', () => {
    let repo: TestRepo;
    before(() => { repo = createRebaseConflictTestRepo(); });
    after(() => { repo.cleanup(); });

    it('keeps the auto stash intact so the user can recover after resolving conflicts', async () => {
      repo.makeChange('scratch.txt', 'untracked work in progress\n');

      await assert.rejects(
        () => sut.rebaseAndStashChanges(repo.git, repo.featureBranch, repo.mainBranch, AUTO_STASH_CURRENT_BRANCH),
        /Rebase failed:[\s\S]*Your changes are preserved in the stash/
      );

      assertRebaseInProgress(repo);
      assert.strictEqual(await repo.git.isWorkdirHasChanges(), true, 'conflicts should leave the worktree dirty');
      assert.match(
        repo.exec('git stash list --format="%gs"'),
        new RegExp(`auto-stash-${repo.featureBranch}-`),
        'timestamped auto stash should be retained after a failed rebase'
      );
      assert.strictEqual(repo.stashCount(), 1);
    });
  });

  describe('target ref variants', () => {
    it('rebases onto a remote-tracking ref', async () => {
      const repo = createRebaseTestRepo();
      try {
        await sut.rebaseAndStashChanges(repo.git, repo.featureBranch, 'origin/main', AUTO_STASH_CURRENT_BRANCH);

        assertHeadContains(repo, 'origin/main');
        assert.strictEqual(await repo.git.isWorkdirHasChanges(), false);
        assert.strictEqual(repo.stashCount(), 0);
      } finally {
        repo.cleanup();
      }
    });

    it('rebases onto a tag ref', async () => {
      const repo = createRebaseTestRepo();
      try {
        await sut.rebaseAndStashChanges(repo.git, repo.featureBranch, 'main-tip', AUTO_STASH_CURRENT_BRANCH);

        assertHeadContains(repo, 'main-tip');
        assert.strictEqual(await repo.git.isWorkdirHasChanges(), false);
        assert.strictEqual(repo.stashCount(), 0);
      } finally {
        repo.cleanup();
      }
    });
  });
});

describe('RebaseWithStashCommand', () => {

  it('passes a remote branch full name to the rebase service', async () => {
    const repo = createRebaseTestRepo();
    const calls: { currentBranch: string; targetRef: string; mode: string }[] = [];
    const fakeAutoStashService = {
      getRebaseStashMode: async () => AUTO_STASH_CURRENT_BRANCH,
      rebaseAndStashChanges: async (
        _git: GitExecutor,
        currentBranch: string,
        targetRef: string,
        mode: string
      ) => {
        calls.push({ currentBranch, targetRef, mode });
      },
    } as unknown as AutoStashService;
    const restoreQuickPick = stubQuickPick((items) =>
      items.find((item) => (item as vscode.QuickPickItem & { ref?: { remote?: string } }).ref?.remote === 'origin')
    );

    try {
      await new TestableRebaseWithStashCommand(repo.git, fakeAutoStashService).execute();

      assert.deepStrictEqual(calls, [
        {
          currentBranch: repo.featureBranch,
          targetRef: 'origin/main',
          mode: AUTO_STASH_CURRENT_BRANCH,
        },
      ]);
    } finally {
      restoreQuickPick();
      repo.cleanup();
    }
  });

  it('does not rebase when stash mode selection is cancelled', async () => {
    const repo = createRebaseTestRepo();
    let rebaseCalled = false;
    const fakeAutoStashService = {
      getRebaseStashMode: async () => undefined,
      rebaseAndStashChanges: async () => { rebaseCalled = true; },
    } as unknown as AutoStashService;

    try {
      await new TestableRebaseWithStashCommand(repo.git, fakeAutoStashService).execute();

      assert.strictEqual(rebaseCalled, false);
    } finally {
      repo.cleanup();
    }
  });

  it('does not rebase when target selection is cancelled', async () => {
    const repo = createRebaseTestRepo();
    let rebaseCalled = false;
    const fakeAutoStashService = {
      getRebaseStashMode: async () => AUTO_STASH_CURRENT_BRANCH,
      rebaseAndStashChanges: async () => { rebaseCalled = true; },
    } as unknown as AutoStashService;
    const restoreQuickPick = stubQuickPick(() => undefined);

    try {
      await new TestableRebaseWithStashCommand(repo.git, fakeAutoStashService).execute();

      assert.strictEqual(rebaseCalled, false);
    } finally {
      restoreQuickPick();
      repo.cleanup();
    }
  });

  it('shows an error when the branch list cannot be loaded', async () => {
    const repo = createRebaseTestRepo();
    const messages: string[] = [];
    const fakeGit = repo.git;
    fakeGit.getAllRefListExtended = async () => {
      throw new Error('branch list failed');
    };
    const fakeAutoStashService = {
      getRebaseStashMode: async () => AUTO_STASH_CURRENT_BRANCH,
      rebaseAndStashChanges: async () => undefined,
    } as unknown as AutoStashService;
    const restoreErrorMessages = stubErrorMessages(messages);

    try {
      await new TestableRebaseWithStashCommand(fakeGit, fakeAutoStashService).execute();

      assert.deepStrictEqual(messages, ['Failed to fetch branch list.']);
    } finally {
      restoreErrorMessages();
      repo.cleanup();
    }
  });

  it('shows an error when the current branch cannot be determined', async () => {
    const repo = createRebaseTestRepo();
    const messages: string[] = [];
    const fakeGit = repo.git;
    fakeGit.getCurrentBranch = async () => '';
    const fakeAutoStashService = {
      getRebaseStashMode: async () => AUTO_STASH_CURRENT_BRANCH,
      rebaseAndStashChanges: async () => undefined,
    } as unknown as AutoStashService;
    const restoreErrorMessages = stubErrorMessages(messages);

    try {
      await new TestableRebaseWithStashCommand(fakeGit, fakeAutoStashService).execute();

      assert.deepStrictEqual(messages, ['Could not determine the current branch. Are you in a git repository?']);
    } finally {
      restoreErrorMessages();
      repo.cleanup();
    }
  });
});
