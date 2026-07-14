import * as assert from 'assert';

import { QuickPickItemKind } from 'vscode';
import { EXTENSION_NAME } from '../../const';
import {
  buildModeQuickPickItems,
  buildQuickActionItems,
  filterVisibleQuickActions,
} from '../../statusBar/statusBarManager';
import { WorktreeQuickActionsState } from '../../statusBar/quickActionsState';
import {
  AUTO_STASH_MODE_BRANCH,
  AUTO_STASH_MODE_MANUAL,
  AUTO_STASH_MODES,
} from '../../configuration/extensionConfig';

const commandId = (name: string) => `${EXTENSION_NAME}.${name}`;

const ALL_TRUE_STATE: WorktreeQuickActionsState = {
  hasRemovableWorktree: true,
  hasMultipleRemovableWorktrees: true,
  hasOtherWorktree: true,
  canCopyStagedToWorktree: true,
  canCopyWipToWorktree: true,
  hasPRReviewWorktree: true,
  isGitHubRepo: true,
};

const ALL_FALSE_STATE: WorktreeQuickActionsState = {
  hasRemovableWorktree: false,
  hasMultipleRemovableWorktrees: false,
  hasOtherWorktree: false,
  canCopyStagedToWorktree: false,
  canCopyWipToWorktree: false,
  hasPRReviewWorktree: false,
  isGitHubRepo: false,
};

const CONDITIONAL_COMMANDS = [
  'copyStagedChangesToWorktree',
  'copyWipChangesToWorktree',
  'copyWipChangesFromWorktree',
  'moveWipChangesFromWorktree',
  'removeWorktree',
  'removeMultipleWorktrees',
  'removePRReviewInWorktree',
  'checkoutByPR',
  'clonePullRequest',
];

const ALWAYS_VISIBLE_COMMANDS = [
  'switchMode',
  'checkoutTo',
  'checkoutPrevious',
  'createBranchFromTemplate',
  'createTagFromTemplate',
  'pullWithStash',
  'pullRebaseWithStash',
  'rebaseWithStash',
  'moveToNewWorktree',
  'prReviewInWorktree',
  'openWorktreeDevTerminal',
  'openSettings',
];

function visibleCommandIds(state: WorktreeQuickActionsState): string[] {
  return filterVisibleQuickActions(buildQuickActionItems('Manual', state))
    .filter((item) => item.commandId)
    .map((item) => item.commandId as string);
}

function separatorLabels(state: WorktreeQuickActionsState): string[] {
  return filterVisibleQuickActions(buildQuickActionItems('Manual', state))
    .filter((item) => item.kind === QuickPickItemKind.Separator)
    .map((item) => item.label);
}

describe('buildQuickActionItems', () => {
  it('shows every conditional item when the state allows it', () => {
    const ids = visibleCommandIds(ALL_TRUE_STATE);

    for (const name of [...ALWAYS_VISIBLE_COMMANDS, ...CONDITIONAL_COMMANDS]) {
      assert.ok(ids.includes(commandId(name)), `expected ${name} to be visible`);
    }
  });

  it('puts the current stash mode brief label in the switch mode description', () => {
    const switchMode = buildQuickActionItems('Auto pop', ALL_FALSE_STATE).find(
      (item) => item.commandId === commandId('switchMode')
    );

    assert.ok(switchMode?.description?.includes('Auto pop'));
  });

  it('tags each conditional item with the matching state flag', () => {
    const byCommand = (name: string) =>
      buildQuickActionItems('Manual', ALL_FALSE_STATE).find(
        (item) => item.commandId === commandId(name)
      );

    assert.strictEqual(byCommand('removeWorktree')?.visible, false);
    assert.strictEqual(byCommand('removeMultipleWorktrees')?.visible, false);
    assert.strictEqual(byCommand('removePRReviewInWorktree')?.visible, false);
    assert.strictEqual(byCommand('copyStagedChangesToWorktree')?.visible, false);
    assert.strictEqual(byCommand('copyWipChangesToWorktree')?.visible, false);
    assert.strictEqual(byCommand('copyWipChangesFromWorktree')?.visible, false);
    assert.strictEqual(byCommand('moveWipChangesFromWorktree')?.visible, false);
    // Always-visible items leave `visible` undefined (defaults to shown).
    assert.strictEqual(byCommand('checkoutTo')?.visible, undefined);
  });
});

describe('filterVisibleQuickActions', () => {
  it('keeps all always-visible actions regardless of state', () => {
    const ids = visibleCommandIds(ALL_FALSE_STATE);

    for (const name of ALWAYS_VISIBLE_COMMANDS) {
      assert.ok(ids.includes(commandId(name)), `expected ${name} to remain visible`);
    }
  });

  it('hides every conditional action and its now-empty separators in an empty state', () => {
    const ids = visibleCommandIds(ALL_FALSE_STATE);

    for (const name of CONDITIONAL_COMMANDS) {
      assert.ok(!ids.includes(commandId(name)), `expected ${name} to be hidden`);
    }

    const separators = separatorLabels(ALL_FALSE_STATE);
    assert.ok(
      !separators.includes('Worktree changes'),
      'the now-empty "Worktree changes" separator should be removed'
    );
    assert.ok(
      !separators.includes('Remove worktrees'),
      'the now-empty "Remove worktrees" separator should be removed'
    );
    // Sections that still have items keep their separators.
    assert.ok(separators.includes('Worktree'));
    assert.ok(separators.includes('Checkout'));
  });

  it('keeps a section separator when at least one item remains', () => {
    const separators = separatorLabels(ALL_TRUE_STATE);

    assert.ok(separators.includes('Worktree changes'));
    assert.ok(separators.includes('Remove worktrees'));
  });

  it('shows "Remove worktree" but hides "Remove multiple worktrees" with a single removable worktree', () => {
    const state: WorktreeQuickActionsState = {
      ...ALL_FALSE_STATE,
      hasRemovableWorktree: true,
      hasOtherWorktree: true,
    };

    const ids = visibleCommandIds(state);

    assert.ok(ids.includes(commandId('removeWorktree')));
    assert.ok(!ids.includes(commandId('removeMultipleWorktrees')));
    assert.ok(separatorLabels(state).includes('Remove worktrees'));
  });

  it('toggles the right copy-to-worktree item for staged-only vs wip-only states', () => {
    const stagedOnly: WorktreeQuickActionsState = {
      ...ALL_FALSE_STATE,
      hasOtherWorktree: true,
      canCopyStagedToWorktree: true,
    };
    const wipOnly: WorktreeQuickActionsState = {
      ...ALL_FALSE_STATE,
      hasOtherWorktree: true,
      canCopyWipToWorktree: true,
    };

    const stagedIds = visibleCommandIds(stagedOnly);
    assert.ok(stagedIds.includes(commandId('copyStagedChangesToWorktree')));
    assert.ok(!stagedIds.includes(commandId('copyWipChangesToWorktree')));

    const wipIds = visibleCommandIds(wipOnly);
    assert.ok(wipIds.includes(commandId('copyWipChangesToWorktree')));
    assert.ok(!wipIds.includes(commandId('copyStagedChangesToWorktree')));
  });

  it('hides GitHub-only actions and their separator for a non-GitHub repo', () => {
    const ids = visibleCommandIds(ALL_FALSE_STATE);

    assert.ok(!ids.includes(commandId('checkoutByPR')));
    assert.ok(!ids.includes(commandId('clonePullRequest')));
    assert.ok(!separatorLabels(ALL_FALSE_STATE).includes('GitHub'));
  });

  it('shows GitHub-only actions for a GitHub repo', () => {
    const state: WorktreeQuickActionsState = { ...ALL_FALSE_STATE, isGitHubRepo: true };
    const ids = visibleCommandIds(state);

    assert.ok(ids.includes(commandId('checkoutByPR')));
    assert.ok(ids.includes(commandId('clonePullRequest')));
    assert.ok(separatorLabels(state).includes('GitHub'));
  });
});

describe('buildModeQuickPickItems', () => {
  it('tags each item with its actual mode value instead of relying on the label text', () => {
    const items = buildModeQuickPickItems(AUTO_STASH_MODE_MANUAL);

    assert.strictEqual(items.length, AUTO_STASH_MODES.length);
    for (const mode of AUTO_STASH_MODES) {
      const item = items.find((i) => i.mode === mode);
      assert.ok(item, `expected an item for mode ${mode}`);
      assert.ok(item!.label.length > 0);
    }
  });

  it('marks only the current mode as "Currently active"', () => {
    const items = buildModeQuickPickItems(AUTO_STASH_MODE_BRANCH);

    const active = items.find((item) => item.detail === 'Currently active');
    assert.strictEqual(active?.mode, AUTO_STASH_MODE_BRANCH);

    const inactive = items.filter((item) => item.mode !== AUTO_STASH_MODE_BRANCH);
    assert.ok(inactive.every((item) => item.detail === undefined));
  });
});
