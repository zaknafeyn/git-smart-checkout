import * as assert from 'assert';
import * as vscode from 'vscode';

import { AUTO_STASH_MODE_BRANCH } from '../../configuration/extensionConfig';
import { EXTENSION_NAME } from '../../const';

import {
  commandId,
  delay,
  ensureExtensionActivated,
  QuickPickLikeItem,
  setExtensionMode,
  stubCreateQuickPick,
  stubErrorMessages,
  withRepoWorkspace,
} from './helpers/commandHarness';
import { createTestRepo, TestRepo } from './helpers/gitTestRepo';

/** Extract the section labels (separator order) and, per section, the ordered branch names. */
function summarizeSections(items: readonly QuickPickLikeItem[]): Array<{ label: string; branches: string[] }> {
  const sections: Array<{ label: string; branches: string[] }> = [];
  for (const item of items) {
    if (item.kind === vscode.QuickPickItemKind.Separator) {
      sections.push({ label: item.label, branches: [] });
      continue;
    }
    if (item.type === 'ref' && item.ref && !item.ref.isTag && !item.ref.remote) {
      sections[sections.length - 1]?.branches.push(item.ref.name);
    }
  }
  return sections;
}

async function setRecentBranchCount(count: number | undefined): Promise<void> {
  await vscode.workspace
    .getConfiguration(EXTENSION_NAME)
    .update('recentBranchCount', count, vscode.ConfigurationTarget.Global);
  await delay(50);
}

/** Real (non-stubbed) sequential checkouts so the reflog reflects genuine branch moves. */
function checkoutSequence(repo: TestRepo, branches: string[]): void {
  for (const branch of branches) {
    repo.exec(`git checkout ${branch}`);
  }
}

describe('checkoutTo — Recent branches section', () => {
  before(async () => {
    await ensureExtensionActivated();
  });

  beforeEach(async () => {
    await setExtensionMode(AUTO_STASH_MODE_BRANCH);
    await setRecentBranchCount(5);
  });

  afterEach(async () => {
    await setRecentBranchCount(undefined);
  });

  it('lists recently checked-out branches, most-recent-first, above Branches, excluding current', async () => {
    const repo = createTestRepo();
    try {
      repo.exec('git branch a');
      repo.exec('git branch b');
      repo.exec('git branch c');
      checkoutSequence(repo, ['a', 'b', 'c', repo.mainBranch]);

      let inspected = false;
      const restoreQuickPick = stubCreateQuickPick((items) => {
        inspected = true;
        const sections = summarizeSections(items);
        const recentSection = sections.find((s) => s.label === 'Recent');
        assert.ok(recentSection, 'Recent separator should be present');
        assert.deepStrictEqual(
          recentSection?.branches.slice(0, 3),
          ['c', 'b', 'a'],
          'Recent should list branches most-recent-first'
        );
        assert.ok(!recentSection?.branches.includes(repo.mainBranch), 'current branch must be excluded from Recent');

        const branchesSection = sections.find((s) => s.label === 'Branches');
        assert.ok(branchesSection, 'Branches separator should be present');
        for (const name of ['a', 'b', 'c']) {
          assert.ok(
            !branchesSection?.branches.includes(name),
            `${name} should not be duplicated in Branches once shown in Recent`
          );
        }
        return undefined;
      });
      const errors = stubErrorMessages();

      try {
        await withRepoWorkspace(repo, async () => {
          await vscode.commands.executeCommand(commandId('checkoutTo'));
          await delay();
          assert.strictEqual(inspected, true);
          assert.deepStrictEqual(errors.messages, []);
        });
      } finally {
        errors.restore();
        restoreQuickPick();
      }
    } finally {
      repo.cleanup();
    }
  });

  it('drops a deleted branch from Recent (existence filter)', async () => {
    const repo = createTestRepo();
    try {
      repo.exec('git branch a');
      repo.exec('git branch b');
      checkoutSequence(repo, ['a', 'b', repo.mainBranch]);
      repo.exec('git branch -D b');

      let inspected = false;
      const restoreQuickPick = stubCreateQuickPick((items) => {
        inspected = true;
        const sections = summarizeSections(items);
        const recentSection = sections.find((s) => s.label === 'Recent');
        assert.ok(!recentSection?.branches.includes('b'), 'deleted branch must not appear in Recent');
        assert.ok(recentSection?.branches.includes('a'), 'still-existing recent branch should remain');
        return undefined;
      });
      const errors = stubErrorMessages();

      try {
        await withRepoWorkspace(repo, async () => {
          await vscode.commands.executeCommand(commandId('checkoutTo'));
          await delay();
          assert.strictEqual(inspected, true);
          assert.deepStrictEqual(errors.messages, []);
        });
      } finally {
        errors.restore();
        restoreQuickPick();
      }
    } finally {
      repo.cleanup();
    }
  });

  it('omits the Recent section entirely when recentBranchCount is 0', async () => {
    await setRecentBranchCount(0);
    const repo = createTestRepo();
    try {
      repo.exec('git branch a');
      checkoutSequence(repo, ['a', repo.mainBranch]);

      let inspected = false;
      const restoreQuickPick = stubCreateQuickPick((items) => {
        inspected = true;
        const sections = summarizeSections(items);
        assert.ok(!sections.some((s) => s.label === 'Recent'), 'Recent separator must be absent when count is 0');
        return undefined;
      });
      const errors = stubErrorMessages();

      try {
        await withRepoWorkspace(repo, async () => {
          await vscode.commands.executeCommand(commandId('checkoutTo'));
          await delay();
          assert.strictEqual(inspected, true);
          assert.deepStrictEqual(errors.messages, []);
        });
      } finally {
        errors.restore();
        restoreQuickPick();
      }
    } finally {
      repo.cleanup();
    }
  });

  it('caps the Recent section at the configured recentBranchCount', async () => {
    await setRecentBranchCount(2);
    const repo = createTestRepo();
    try {
      for (const name of ['a', 'b', 'c']) {
        repo.exec(`git branch ${name}`);
      }
      checkoutSequence(repo, ['a', 'b', 'c', repo.mainBranch]);

      let inspected = false;
      const restoreQuickPick = stubCreateQuickPick((items) => {
        inspected = true;
        const sections = summarizeSections(items);
        const recentSection = sections.find((s) => s.label === 'Recent');
        assert.ok(recentSection, 'Recent separator should be present');
        assert.strictEqual(recentSection?.branches.length, 2, 'Recent should be capped to recentBranchCount');
        assert.deepStrictEqual(recentSection?.branches, ['c', 'b']);
        return undefined;
      });
      const errors = stubErrorMessages();

      try {
        await withRepoWorkspace(repo, async () => {
          await vscode.commands.executeCommand(commandId('checkoutTo'));
          await delay();
          assert.strictEqual(inspected, true);
          assert.deepStrictEqual(errors.messages, []);
        });
      } finally {
        errors.restore();
        restoreQuickPick();
      }
    } finally {
      repo.cleanup();
    }
  });
});
