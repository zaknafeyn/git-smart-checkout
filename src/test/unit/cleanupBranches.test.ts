import * as assert from 'assert';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QuickPickItemKind } from 'vscode';

import {
  buildCleanupQuickPickItems,
  buildConfirmDeletionMessage,
  buildRecoveryDocument,
  computeCleanupCandidates,
  ICleanupQuickPickItem,
  IPrMergeInfo,
  summarizeDeletions,
  toSelectedCandidates,
} from '../../commands/cleanupBranchesCommand/candidates';
import { GitExecutor } from '../../common/git/gitExecutor';
import { IGitRef } from '../../common/git/types';
import { LoggingService } from '../../logging/loggingService';
import { mockLogService } from '../e2e/helpers/mockLogService';

function ref(name: string, overrides: Partial<IGitRef> = {}): IGitRef {
  return {
    authorName: 'Test',
    name,
    fullName: name,
    hash: `${name}-sha`,
    committerDate: '1700000000',
    ...overrides,
  };
}

describe('computeCleanupCandidates', () => {
  it('unions merged branches with gone-upstream branches, excluding current/default/worktree-checked-out', () => {
    const refs = [
      ref('merged-1'),
      ref('merged-2'),
      ref('active'), // unmerged, no gone upstream -> excluded
      ref('orphan', { upstreamTrack: '[gone]' }),
      ref('current-branch'),
      ref('main'),
      ref('checked-out-elsewhere'),
    ];
    const mergedNames = new Set(['merged-1', 'merged-2', 'current-branch', 'main']);
    const worktreeBranches = new Set(['checked-out-elsewhere']);

    const candidates = computeCleanupCandidates(refs, mergedNames, worktreeBranches, 'current-branch', 'main');

    assert.deepStrictEqual(
      candidates.map((candidate) => candidate.ref.name).sort(),
      ['merged-1', 'merged-2', 'orphan'].sort()
    );
  });

  it('classifies merged branches as "merged" and gone-only branches as "gone"', () => {
    const refs = [ref('merged-1'), ref('orphan', { upstreamTrack: '[gone]' })];
    const candidates = computeCleanupCandidates(
      refs,
      new Set(['merged-1']),
      new Set(),
      'unrelated',
      'main'
    );

    assert.strictEqual(candidates.find((c) => c.ref.name === 'merged-1')?.group, 'merged');
    assert.strictEqual(candidates.find((c) => c.ref.name === 'orphan')?.group, 'gone');
  });

  it('classifies a branch that is both merged and gone as "merged"', () => {
    const refs = [ref('both', { upstreamTrack: '[gone]' })];
    const candidates = computeCleanupCandidates(refs, new Set(['both']), new Set(), 'unrelated', 'main');

    assert.strictEqual(candidates[0].group, 'merged');
  });

  it('classifies a patch-equivalence squash-merged branch as "squashMerged"', () => {
    const refs = [ref('squashed')];
    const candidates = computeCleanupCandidates(
      refs,
      new Set(),
      new Set(),
      'unrelated',
      'main',
      new Set(['squashed'])
    );

    assert.strictEqual(candidates[0].group, 'squashMerged');
    assert.strictEqual(candidates[0].squashSource, 'patchEquivalence');
  });

  it('does not double-report an ancestor-merged (orphaned/empty) branch as squash-merged too', () => {
    // Simulates an orphaned branch (tip === merge-base): getMergedBranches already
    // reports it as merged, so it must never additionally show up via the
    // patch-equivalence or PR-merge signals.
    const refs = [ref('orphan')];
    const prMergeInfo = new Map<string, IPrMergeInfo>([['orphan', { prNumber: 7, diverged: false }]]);
    const candidates = computeCleanupCandidates(
      refs,
      new Set(['orphan']),
      new Set(),
      'unrelated',
      'main',
      new Set(['orphan']),
      prMergeInfo
    );

    assert.strictEqual(candidates.length, 1);
    assert.strictEqual(candidates[0].group, 'merged');
  });

  it('prefers GitHub PR-merge info over patch equivalence when both signals apply', () => {
    const refs = [ref('feature')];
    const prMergeInfo = new Map<string, IPrMergeInfo>([['feature', { prNumber: 42, diverged: false }]]);
    const candidates = computeCleanupCandidates(
      refs,
      new Set(),
      new Set(),
      'unrelated',
      'main',
      new Set(['feature']),
      prMergeInfo
    );

    assert.strictEqual(candidates[0].squashSource, 'prMerged');
    assert.strictEqual(candidates[0].prNumber, 42);
  });

  it('classifies a branch whose merged PR tip has diverged as "prDiverged"', () => {
    const refs = [ref('feature')];
    const prMergeInfo = new Map<string, IPrMergeInfo>([['feature', { prNumber: 42, diverged: true }]]);
    const candidates = computeCleanupCandidates(refs, new Set(), new Set(), 'unrelated', 'main', new Set(), prMergeInfo);

    assert.strictEqual(candidates[0].group, 'squashMerged');
    assert.strictEqual(candidates[0].squashSource, 'prDiverged');
  });
});

describe('buildCleanupQuickPickItems', () => {
  it('groups items under "Merged into <base>" and "Upstream deleted" separators', () => {
    const candidates = computeCleanupCandidates(
      [ref('merged-1'), ref('orphan', { upstreamTrack: '[gone]' })],
      new Set(['merged-1']),
      new Set(),
      'unrelated',
      'main'
    );

    const items = buildCleanupQuickPickItems(candidates, 'main');
    const separatorLabels = items
      .filter((item) => item.kind === QuickPickItemKind.Separator)
      .map((item) => item.label);

    assert.deepStrictEqual(separatorLabels, ['Merged into main', 'Upstream deleted']);
  });

  it('pre-checks merged items and leaves unmerged-gone items unchecked', () => {
    const candidates = computeCleanupCandidates(
      [ref('merged-1'), ref('orphan', { upstreamTrack: '[gone]' })],
      new Set(['merged-1']),
      new Set(),
      'unrelated',
      'main'
    );

    const items = buildCleanupQuickPickItems(candidates, 'main') as ICleanupQuickPickItem[];
    const merged = items.find((item) => item.candidate?.ref.name === 'merged-1');
    const gone = items.find((item) => item.candidate?.ref.name === 'orphan');

    assert.strictEqual(merged?.picked, true);
    assert.strictEqual(gone?.picked, false);
  });

  it('describes unmerged-gone items with a force-delete warning', () => {
    const candidates = computeCleanupCandidates(
      [ref('orphan', { upstreamTrack: '[gone]' })],
      new Set(),
      new Set(),
      'unrelated',
      'main'
    );

    const items = buildCleanupQuickPickItems(candidates, 'main') as ICleanupQuickPickItem[];
    const gone = items.find((item) => item.candidate?.ref.name === 'orphan');

    assert.ok(gone?.description?.includes('not merged — force delete'));
    // The QuickPick description shows a truncated (7-char) SHA for compact
    // display; the full SHA is still used for the recovery document (see
    // buildRecoveryDocument tests below).
    assert.ok(gone?.description?.includes('orphan-'.slice(0, 7)));
  });

  it('omits a group separator entirely when that group has no candidates', () => {
    const candidates = computeCleanupCandidates([ref('merged-1')], new Set(['merged-1']), new Set(), 'unrelated', 'main');
    const items = buildCleanupQuickPickItems(candidates, 'main');
    const separatorLabels = items
      .filter((item) => item.kind === QuickPickItemKind.Separator)
      .map((item) => item.label);

    assert.deepStrictEqual(separatorLabels, ['Merged into main']);
  });

  it('pre-checks patch-equivalence and prMerged squash-merged items, but leaves prDiverged unchecked and still lists it', () => {
    const refs = [ref('patch-squashed'), ref('pr-squashed'), ref('pr-diverged')];
    const prMergeInfo = new Map<string, IPrMergeInfo>([
      ['pr-squashed', { prNumber: 10, diverged: false }],
      ['pr-diverged', { prNumber: 11, diverged: true }],
    ]);
    const candidates = computeCleanupCandidates(
      refs,
      new Set(),
      new Set(),
      'unrelated',
      'main',
      new Set(['patch-squashed']),
      prMergeInfo
    );

    const items = buildCleanupQuickPickItems(candidates, 'main') as ICleanupQuickPickItem[];
    const byName = (name: string) => items.find((item) => item.candidate?.ref.name === name);

    assert.strictEqual(byName('patch-squashed')?.picked, true);
    assert.strictEqual(byName('pr-squashed')?.picked, true);
    assert.strictEqual(byName('pr-diverged')?.picked, false);

    // Still listed as a candidate, just unchecked.
    assert.ok(byName('pr-diverged'));
    assert.ok(byName('pr-diverged')?.description?.includes('diverged after merge'));
  });

  it('describes squash-merged items with their detection source', () => {
    const refs = [ref('patch-squashed'), ref('pr-squashed')];
    const prMergeInfo = new Map<string, IPrMergeInfo>([['pr-squashed', { prNumber: 99, diverged: false }]]);
    const candidates = computeCleanupCandidates(
      refs,
      new Set(),
      new Set(),
      'unrelated',
      'main',
      new Set(['patch-squashed']),
      prMergeInfo
    );

    const items = buildCleanupQuickPickItems(candidates, 'main') as ICleanupQuickPickItem[];
    const byName = (name: string) => items.find((item) => item.candidate?.ref.name === name);

    assert.ok(byName('patch-squashed')?.description?.includes('squash-merged'));
    assert.ok(byName('pr-squashed')?.description?.includes('PR #99 merged'));
  });

  it('groups squash-merged candidates under their own "Squash-merged" separator', () => {
    const refs = [ref('merged-1'), ref('squashed'), ref('orphan', { upstreamTrack: '[gone]' })];
    const candidates = computeCleanupCandidates(
      refs,
      new Set(['merged-1']),
      new Set(),
      'unrelated',
      'main',
      new Set(['squashed'])
    );

    const items = buildCleanupQuickPickItems(candidates, 'main');
    const separatorLabels = items
      .filter((item) => item.kind === QuickPickItemKind.Separator)
      .map((item) => item.label);

    assert.deepStrictEqual(separatorLabels, ['Merged into main', 'Squash-merged', 'Upstream deleted']);
  });
});

describe('buildConfirmDeletionMessage', () => {
  it('adds no extra line when nothing selected is patch-equivalence squash-merged', () => {
    const candidates = computeCleanupCandidates([ref('merged-1')], new Set(['merged-1']), new Set(), 'unrelated', 'main');
    const message = buildConfirmDeletionMessage(candidates);

    assert.ok(!message.includes('squash-merged (verified by patch equivalence)'));
  });

  it('reports how many selected branches were verified squash-merged by patch equivalence', () => {
    const refs = [ref('squashed-1'), ref('squashed-2'), ref('pr-merged')];
    const prMergeInfo = new Map<string, IPrMergeInfo>([['pr-merged', { prNumber: 5, diverged: false }]]);
    const candidates = computeCleanupCandidates(
      refs,
      new Set(),
      new Set(),
      'unrelated',
      'main',
      new Set(['squashed-1', 'squashed-2']),
      prMergeInfo
    );

    const message = buildConfirmDeletionMessage(candidates);

    assert.ok(message.includes('2 branches are squash-merged (verified by patch equivalence).'));
  });
});

describe('toSelectedCandidates', () => {
  it('filters out separators and keeps only actionable candidates', () => {
    const candidates = computeCleanupCandidates([ref('merged-1')], new Set(['merged-1']), new Set(), 'unrelated', 'main');
    const items = buildCleanupQuickPickItems(candidates, 'main');

    assert.strictEqual(toSelectedCandidates(items).length, 1);
    assert.strictEqual(toSelectedCandidates(undefined).length, 0);
  });
});

describe('buildRecoveryDocument', () => {
  it('emits one "git branch <name> <sha>" line per successfully deleted branch', () => {
    const doc = buildRecoveryDocument([
      { name: 'merged-1', sha: 'aaa1111', success: true },
      { name: 'merged-2', sha: 'bbb2222', success: true },
      { name: 'orphan', sha: 'ccc3333', success: true },
    ]);

    assert.ok(doc.includes('git branch merged-1 aaa1111'));
    assert.ok(doc.includes('git branch merged-2 bbb2222'));
    assert.ok(doc.includes('git branch orphan ccc3333'));
  });

  it('excludes failed deletions from the recovery document', () => {
    const doc = buildRecoveryDocument([
      { name: 'merged-1', sha: 'aaa1111', success: true },
      { name: 'merged-2', sha: 'bbb2222', success: false },
    ]);

    assert.ok(doc.includes('git branch merged-1 aaa1111'));
    assert.ok(!doc.includes('merged-2'));
  });
});

describe('summarizeDeletions', () => {
  it('reports a clean summary when everything succeeds', () => {
    assert.strictEqual(
      summarizeDeletions([
        { name: 'a', sha: '1', success: true },
        { name: 'b', sha: '2', success: true },
      ]),
      'Deleted 2 branches'
    );
  });

  it('reports partial failures without aborting the batch', () => {
    assert.strictEqual(
      summarizeDeletions([
        { name: 'a', sha: '1', success: true },
        { name: 'b', sha: '2', success: false },
        { name: 'c', sha: '3', success: true },
      ]),
      'Deleted 2 branches, 1 failed'
    );
  });
});

describe('GitExecutor.getDefaultBranch', () => {
  function initRepo(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    execSync('git init -q', { cwd: dir });
    execSync('git config user.email "test@test.local"', { cwd: dir });
    execSync('git config user.name "Test"', { cwd: dir });
    return dir;
  }

  function commit(dir: string, message: string) {
    fs.writeFileSync(path.join(dir, 'file.txt'), `${message}\n`);
    execSync('git add file.txt', { cwd: dir });
    execSync(`git commit -q -m "${message}"`, { cwd: dir });
  }

  it('resolves via origin/HEAD when present', async () => {
    const remoteDir = initRepo('gsc-default-remote-');
    execSync('git checkout -q -b trunk', { cwd: remoteDir });
    commit(remoteDir, 'init');

    const dir = initRepo('gsc-default-local-');
    execSync('git checkout -q -b unrelated', { cwd: dir });
    commit(dir, 'init');
    execSync(`git remote add origin "${remoteDir}"`, { cwd: dir });
    execSync('git fetch -q origin', { cwd: dir });
    execSync('git remote set-head origin trunk', { cwd: dir });

    const git = new GitExecutor(dir, mockLogService as unknown as LoggingService);
    assert.strictEqual(await git.getDefaultBranch(), 'trunk');
    fs.rmSync(remoteDir, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('falls back to a local "main" branch when origin/HEAD is absent', async () => {
    const dir = initRepo('gsc-default-main-');
    execSync('git checkout -q -b main', { cwd: dir });
    commit(dir, 'init');

    const git = new GitExecutor(dir, mockLogService as unknown as LoggingService);
    assert.strictEqual(await git.getDefaultBranch(), 'main');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('falls back to a local "master" branch when origin/HEAD and "main" are absent', async () => {
    const dir = initRepo('gsc-default-master-');
    execSync('git checkout -q -b master', { cwd: dir });
    commit(dir, 'init');

    const git = new GitExecutor(dir, mockLogService as unknown as LoggingService);
    assert.strictEqual(await git.getDefaultBranch(), 'master');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('throws a descriptive error when no default branch can be determined', async () => {
    const dir = initRepo('gsc-default-none-');
    execSync('git checkout -q -b develop', { cwd: dir });
    commit(dir, 'init');

    const git = new GitExecutor(dir, mockLogService as unknown as LoggingService);
    await assert.rejects(() => git.getDefaultBranch(), /Could not determine the default branch/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('GitExecutor.getMergedBranches', () => {
  it('lists local branches merged into the given base, excluding still-unmerged branches', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsc-merged-'));
    execSync('git init -q -b main', { cwd: dir });
    execSync('git config user.email "test@test.local"', { cwd: dir });
    execSync('git config user.name "Test"', { cwd: dir });
    fs.writeFileSync(path.join(dir, 'file.txt'), 'a\n');
    execSync('git add file.txt', { cwd: dir });
    execSync('git commit -q -m init', { cwd: dir });
    execSync('git checkout -q -b merged-branch', { cwd: dir });
    execSync('git checkout -q main', { cwd: dir });
    execSync('git merge -q merged-branch --ff-only', { cwd: dir });
    execSync('git checkout -q -b unmerged-branch', { cwd: dir });
    fs.writeFileSync(path.join(dir, 'file2.txt'), 'b\n');
    execSync('git add file2.txt', { cwd: dir });
    execSync('git commit -q -m more', { cwd: dir });
    execSync('git checkout -q main', { cwd: dir });

    const git = new GitExecutor(dir, mockLogService as unknown as LoggingService);
    const merged = await git.getMergedBranches('main');

    assert.ok(merged.includes('merged-branch'));
    assert.ok(merged.includes('main'));
    assert.ok(!merged.includes('unmerged-branch'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('GitExecutor.isSquashMerged', () => {
  function initRepo(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    execSync('git init -q -b main', { cwd: dir });
    execSync('git config user.email "test@test.local"', { cwd: dir });
    execSync('git config user.name "Test"', { cwd: dir });
    return dir;
  }

  function writeAndCommit(dir: string, file: string, content: string, message: string) {
    fs.writeFileSync(path.join(dir, file), content);
    execSync(`git add ${file}`, { cwd: dir });
    execSync(`git commit -q -m "${message}"`, { cwd: dir });
  }

  it('returns true for a branch whose changes were squash-merged into base', async () => {
    const dir = initRepo('gsc-squash-true-');
    writeAndCommit(dir, 'base.txt', 'a\n', 'init');

    execSync('git checkout -q -b feature', { cwd: dir });
    writeAndCommit(dir, 'feature.txt', 'feature line 1\n', 'feature commit 1');
    writeAndCommit(dir, 'feature.txt', 'feature line 1\nfeature line 2\n', 'feature commit 2');

    execSync('git checkout -q main', { cwd: dir });
    // Simulate GitHub's squash merge: a single new commit on main with the
    // combined diff, no merge commit, no ancestry link back to `feature`.
    execSync('git merge -q --squash feature', { cwd: dir });
    execSync('git commit -q -m "Squash merge feature (#1)"', { cwd: dir });

    const git = new GitExecutor(dir, mockLogService as unknown as LoggingService);
    assert.strictEqual(await git.isSquashMerged('main', 'feature'), true);
    // Sanity check: git's own ancestry check does NOT see this as merged.
    assert.ok(!(await git.getMergedBranches('main')).includes('feature'));

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns false for a branch with an extra unmerged commit on top of a squash-merged base', async () => {
    const dir = initRepo('gsc-squash-false-');
    writeAndCommit(dir, 'base.txt', 'a\n', 'init');

    execSync('git checkout -q -b feature', { cwd: dir });
    writeAndCommit(dir, 'feature.txt', 'feature line 1\n', 'feature commit 1');

    execSync('git checkout -q main', { cwd: dir });
    execSync('git merge -q --squash feature', { cwd: dir });
    execSync('git commit -q -m "Squash merge feature (#1)"', { cwd: dir });

    // Branch keeps going after the squash merge landed — its combined patch no
    // longer matches what's in base.
    execSync('git checkout -q feature', { cwd: dir });
    writeAndCommit(dir, 'feature.txt', 'feature line 1\nunmerged addition\n', 'unmerged follow-up');
    execSync('git checkout -q main', { cwd: dir });

    const git = new GitExecutor(dir, mockLogService as unknown as LoggingService);
    assert.strictEqual(await git.isSquashMerged('main', 'feature'), false);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns false for a branch that was never merged at all', async () => {
    const dir = initRepo('gsc-squash-unmerged-');
    writeAndCommit(dir, 'base.txt', 'a\n', 'init');

    execSync('git checkout -q -b feature', { cwd: dir });
    writeAndCommit(dir, 'feature.txt', 'never merged\n', 'feature commit');
    execSync('git checkout -q main', { cwd: dir });

    const git = new GitExecutor(dir, mockLogService as unknown as LoggingService);
    assert.strictEqual(await git.isSquashMerged('main', 'feature'), false);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
