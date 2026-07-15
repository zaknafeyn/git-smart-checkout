import { formatDistanceToNow } from 'date-fns';
import * as vscode from 'vscode';
import { IGitRef } from '../../common/git/types';

export type TCleanupGroup = 'merged' | 'gone';

export interface ICleanupCandidate {
  ref: IGitRef;
  /** `merged` deletes with `-d`; `gone` (unmerged, upstream deleted) deletes with `-D`. */
  group: TCleanupGroup;
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
 */
export function computeCleanupCandidates(
  localRefs: IGitRef[],
  mergedNames: Set<string>,
  worktreeBranches: Set<string>,
  current: string,
  base: string
): ICleanupCandidate[] {
  return localRefs
    .filter((ref) => ref.name !== current && ref.name !== base && !worktreeBranches.has(ref.name))
    .filter((ref) => mergedNames.has(ref.name) || ref.upstreamTrack === '[gone]')
    .map((ref) => ({ ref, group: mergedNames.has(ref.name) ? 'merged' as const : 'gone' as const }));
}

function describeCandidate(candidate: ICleanupCandidate): string {
  const { ref, group } = candidate;
  const relativeDate = ref.committerDate
    ? formatDistanceToNow(Number(ref.committerDate) * 1000, { addSuffix: true })
    : undefined;
  const sha = ref.hash;
  const parts = [relativeDate, sha].filter((part): part is string => !!part && part.length > 0);

  if (group === 'gone') {
    parts.push('not merged — force delete');
  }

  return parts.join(' • ');
}

/**
 * Builds the multi-select QuickPick items, grouped by separators
 * "Merged into <base>" and "Upstream deleted". Merged items are pre-checked;
 * unmerged-gone items are unchecked by default since they require a force delete.
 */
export function buildCleanupQuickPickItems(
  candidates: ICleanupCandidate[],
  base: string
): TCleanupPickItem[] {
  const merged = candidates.filter((candidate) => candidate.group === 'merged');
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
