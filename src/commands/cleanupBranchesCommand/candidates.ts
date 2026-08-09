import { formatDistanceToNow } from 'date-fns';
import * as vscode from 'vscode';
import { IGitRef } from '../../common/git/types';

export type TCleanupGroup = 'merged' | 'gone' | 'squashMerged';

/**
 * How a `squashMerged` candidate was detected:
 * - `patchEquivalence`: offline `GitExecutor.isSquashMerged` (git-delete-squashed technique).
 * - `prMerged`: a GitHub PR for this branch has `state: merged` and the PR's `head.sha` still
 *   matches the branch's local tip.
 * - `prDiverged`: same as `prMerged`, but the branch tip has moved since the PR merged — still a
 *   candidate, but excluded from preselection since the extra commits were never reviewed/merged.
 */
export type TSquashSource = 'patchEquivalence' | 'prMerged' | 'prDiverged';

export interface ICleanupCandidate {
  ref: IGitRef;
  /** `merged` deletes with `-d`; `gone`/`squashMerged` (unmerged from git's view) delete with `-D`. */
  group: TCleanupGroup;
  /** Set only when `group === 'squashMerged'`. */
  squashSource?: TSquashSource;
  /** Set only when `squashSource` is `prMerged` or `prDiverged`. */
  prNumber?: number;
}

/** Per-branch GitHub PR merge state, keyed by branch (PR head ref) name. */
export interface IPrMergeInfo {
  prNumber: number;
  /** True when the branch's local tip SHA no longer matches the merged PR's `head.sha`. */
  diverged: boolean;
}

export interface ICleanupQuickPickItem extends vscode.QuickPickItem {
  candidate: ICleanupCandidate;
}

export type TCleanupPickItem = ICleanupQuickPickItem | (vscode.QuickPickItem & { candidate?: undefined });

export interface ICleanupDeletionResult {
  name: string;
  /** Tip SHA captured before deletion, used to build the recovery document. */
  sha: string;
  success: boolean;
}

/**
 * Local branches merged into `base` OR whose upstream is `[gone]`, excluding the
 * current branch, the default branch itself, and any branch checked out in a
 * worktree. A branch that is both merged and gone is classified as `merged`
 * (safe `-d` delete still applies).
 *
 * `squashMergedNames` and `prMergeInfo` are optional extra signals — offline
 * patch-equivalence detection and GitHub PR state, respectively — for branches
 * `git branch --merged` can't see because the merge rewrote history (squash or
 * rebase merge). A branch already classified `merged` (ancestor-merged, which
 * includes the "empty"/orphaned case where the branch tip equals the merge
 * base) is never re-checked against these, so it's never double-reported.
 * When both signals apply to the same branch, the more precise GitHub PR
 * signal (`prMerged`/`prDiverged`) wins over the offline `patchEquivalence`
 * guess.
 */
export function computeCleanupCandidates(
  localRefs: IGitRef[],
  mergedNames: Set<string>,
  worktreeBranches: Set<string>,
  current: string,
  base: string,
  squashMergedNames: Set<string> = new Set(),
  prMergeInfo: Map<string, IPrMergeInfo> = new Map()
): ICleanupCandidate[] {
  return localRefs
    .filter((ref) => ref.name !== current && ref.name !== base && !worktreeBranches.has(ref.name))
    .map((ref): ICleanupCandidate | undefined => {
      if (mergedNames.has(ref.name)) {
        return { ref, group: 'merged' };
      }

      const prInfo = prMergeInfo.get(ref.name);
      if (prInfo) {
        return {
          ref,
          group: 'squashMerged',
          squashSource: prInfo.diverged ? 'prDiverged' : 'prMerged',
          prNumber: prInfo.prNumber,
        };
      }

      if (squashMergedNames.has(ref.name)) {
        return { ref, group: 'squashMerged', squashSource: 'patchEquivalence' };
      }

      if (ref.upstreamTrack === '[gone]') {
        return { ref, group: 'gone' };
      }

      return undefined;
    })
    .filter((candidate): candidate is ICleanupCandidate => candidate !== undefined);
}

function describeCandidate(candidate: ICleanupCandidate): string {
  const { ref, group, squashSource, prNumber } = candidate;
  const relativeDate = ref.committerDate
    ? formatDistanceToNow(Number(ref.committerDate) * 1000, { addSuffix: true })
    : undefined;
  const sha = ref.hash;
  const parts = [relativeDate, sha].filter((part): part is string => !!part && part.length > 0);

  if (group === 'gone') {
    parts.push('not merged — force delete');
  } else if (group === 'squashMerged') {
    if (squashSource === 'prMerged') {
      parts.push(`PR #${prNumber} merged`);
    } else if (squashSource === 'prDiverged') {
      parts.push('diverged after merge (unchecked)');
    } else {
      parts.push('squash-merged');
    }
  }

  return parts.join(' • ');
}

/**
 * Builds the multi-select QuickPick items, grouped by separators
 * "Merged into <base>", "Squash-merged", and "Upstream deleted". Merged and
 * squash-merged items are pre-checked, EXCEPT `prDiverged` squash-merged
 * items (the branch moved on after its PR merged, so the extra commits were
 * never reviewed) which are shown but left unchecked. Unmerged-gone items are
 * also unchecked by default since they require a force delete.
 */
export function buildCleanupQuickPickItems(
  candidates: ICleanupCandidate[],
  base: string
): TCleanupPickItem[] {
  const merged = candidates.filter((candidate) => candidate.group === 'merged');
  const squashMerged = candidates.filter((candidate) => candidate.group === 'squashMerged');
  const gone = candidates.filter((candidate) => candidate.group === 'gone');
  const items: TCleanupPickItem[] = [];

  if (merged.length > 0) {
    items.push({ label: `Merged into ${base}`, kind: vscode.QuickPickItemKind.Separator });
    items.push(...merged.map((candidate) => ({
      label: candidate.ref.name,
      description: describeCandidate(candidate),
      picked: true,
      candidate,
    })));
  }

  if (squashMerged.length > 0) {
    items.push({ label: 'Squash-merged', kind: vscode.QuickPickItemKind.Separator });
    items.push(...squashMerged.map((candidate) => ({
      label: candidate.ref.name,
      description: describeCandidate(candidate),
      picked: candidate.squashSource !== 'prDiverged',
      candidate,
    })));
  }

  if (gone.length > 0) {
    items.push({ label: 'Upstream deleted', kind: vscode.QuickPickItemKind.Separator });
    items.push(...gone.map((candidate) => ({
      label: candidate.ref.name,
      description: describeCandidate(candidate),
      picked: false,
      candidate,
    })));
  }

  return items;
}

/**
 * Confirmation dialog message for a batch delete. Appends a line calling out
 * how many of the selected branches were verified squash-merged by patch
 * equivalence (the offline `git-delete-squashed` technique) — those look
 * unmerged to git and need `-D`, so it's worth surfacing why they're safe.
 */
export function buildConfirmDeletionMessage(selected: ICleanupCandidate[]): string {
  const patchEquivalentCount = selected.filter(
    (candidate) => candidate.group === 'squashMerged' && candidate.squashSource === 'patchEquivalence'
  ).length;

  const lines = [`Delete ${selected.length} branches? They can be recovered from the reflog for ~30 days.`];
  if (patchEquivalentCount > 0) {
    lines.push(`${patchEquivalentCount} branches are squash-merged (verified by patch equivalence).`);
  }

  return lines.join('\n');
}

/** Narrows selected QuickPick items down to the actual deletion candidates. */
export function toSelectedCandidates(selected: readonly TCleanupPickItem[] | undefined): ICleanupCandidate[] {
  return (selected ?? [])
    .filter((item): item is ICleanupQuickPickItem => item.candidate !== undefined)
    .map((item) => item.candidate);
}

/**
 * Builds a "Undo hint" recovery document: one `git branch <name> <sha>` line
 * per successfully deleted branch, using the tip SHA captured before deletion.
 */
export function buildRecoveryDocument(deletions: ICleanupDeletionResult[]): string {
  const successful = deletions.filter((deletion) => deletion.success);
  const lines = [
    '# Branch cleanup recovery',
    '',
    'Run any of the commands below to restore a deleted branch at its previous tip.',
    'This works for as long as the commit stays reachable via the reflog (~30 days by default).',
    '',
    ...successful.map((deletion) => `git branch ${deletion.name} ${deletion.sha}`),
    '',
  ];

  return lines.join('\n');
}

export function summarizeDeletions(deletions: ICleanupDeletionResult[]): string {
  const deletedCount = deletions.filter((deletion) => deletion.success).length;
  const failedCount = deletions.length - deletedCount;

  return failedCount > 0
    ? `Deleted ${deletedCount} branches, ${failedCount} failed`
    : `Deleted ${deletedCount} branches`;
}
