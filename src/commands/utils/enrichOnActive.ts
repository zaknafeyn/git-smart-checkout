import * as vscode from 'vscode';

import { GitExecutor } from '../../common/git/gitExecutor';
import { getFullRefname } from '../../common/git/refName';
import { IGitRef } from '../../common/git/types';
import { RefDetailsCache, mergeRefDetails } from '../../services/refDetailsCache';
import { refreshRefDetails } from './refDetailsPrefetch';

export interface EnrichableItem extends vscode.QuickPickItem {
  ref?: IGitRef;
}

export interface LazyEnrichOptions<T extends EnrichableItem> {
  quickPick: vscode.QuickPick<T>;
  git: GitExecutor;
  /** Rebuilds the full item list from the (mutated) branch list. */
  rebuild: () => T[];
  repoKey?: string;
  cache?: RefDetailsCache;
}

/**
 * Lazily enrich the highlighted picker item with commit details (date, author,
 * message, ahead/behind) via the VS Code Git API — no spawned git processes.
 *
 * The full list is shown instantly (label only); when the user highlights a row
 * we fetch just that ref's details, merge them into the live IGitRef, and rebuild
 * the items. Results are cached per ref so re-highlighting is instant, and a
 * race guard ensures a slow lookup never repaints over an item the user moved on
 * from. Returns a Disposable that detaches the listener.
 */
export function attachLazyEnrichment<T extends EnrichableItem>(
  options: LazyEnrichOptions<T>
): vscode.Disposable {
  const { quickPick, git, rebuild, repoKey, cache } = options;

  const sessionCache = new Map<string, Partial<IGitRef>>();
  const inFlight = new Set<string>();

  const activeKey = (): string | undefined => {
    const ref = quickPick.activeItems[0]?.ref;
    return ref ? getFullRefname(ref) : undefined;
  };

  return quickPick.onDidChangeActive(async (active) => {
    const ref = active[0]?.ref;
    if (!ref) {
      return;
    }

    const key = getFullRefname(ref);
    if (sessionCache.has(key) || inFlight.has(key)) {
      return;
    }

    inFlight.add(key);
    let details: Partial<IGitRef> | undefined;
    try {
      details = repoKey
        ? await refreshRefDetails(repoKey, git, cache, ref)
        : await git.getRefDetailsFast(ref);
    } catch {
      details = undefined;
    } finally {
      inFlight.delete(key);
    }
    sessionCache.set(key, details ?? {});

    // No provider / nothing resolved — leave the row as-is (label only).
    if (!details || Object.keys(details).length === 0) {
      return;
    }

    // Merge resolved fields into the live ref so rebuild() reflects them.
    // Skip undefined so we never clobber a value the fast list already provided.
    mergeRefDetails(ref, details);

    // Race guard: only repaint if the user is still on this item.
    if (activeKey() !== key) {
      return;
    }

    // Repaint, then restore the highlight so it doesn't jump. The cache early
    // return above makes the re-fired onDidChangeActive a no-op (no loop).
    quickPick.items = rebuild();
    const match = quickPick.items.find((item) => item.ref && getFullRefname(item.ref) === key);
    if (match) {
      quickPick.activeItems = [match];
    }
  });
}
