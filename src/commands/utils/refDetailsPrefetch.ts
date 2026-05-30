import * as vscode from 'vscode';

import { GitExecutor } from '../../common/git/gitExecutor';
import { getFullRefname } from '../../common/git/refName';
import { IGitRef } from '../../common/git/types';
import { RefDetailsCache, mergeRefDetails } from '../../services/refDetailsCache';
import type { EnrichableItem } from './enrichOnActive';

const TOP_PREFETCH_COUNT = 20;
const BACKGROUND_CONCURRENCY = 4;

export interface RefDetailsPrefetchOptions<T extends EnrichableItem> {
  repoKey: string;
  refs: IGitRef[];
  git: GitExecutor;
  cache?: RefDetailsCache;
  buildItems: () => T[];
}

export interface BackgroundRefreshOptions<T extends EnrichableItem> {
  quickPick: vscode.QuickPick<T>;
  rebuild: () => T[];
}

export async function prepareInitialRefDetails<T extends EnrichableItem>(
  options: RefDetailsPrefetchOptions<T>
): Promise<void> {
  const { repoKey, refs, git, cache, buildItems } = options;
  if (!cache) {
    return;
  }

  const selectableRefs = getSelectableRefs(buildItems());
  const topRefs = selectableRefs.slice(0, TOP_PREFETCH_COUNT);
  const missingTopRefs = topRefs.filter((ref) => cache.isMissing(repoKey, ref));
  cache.apply(repoKey, refs);

  await refreshRefs({
    repoKey,
    refs: missingTopRefs,
    git,
    cache,
    concurrency: BACKGROUND_CONCURRENCY,
  });
}

export function refreshRemainingRefDetails<T extends EnrichableItem>(
  options: RefDetailsPrefetchOptions<T> & BackgroundRefreshOptions<T>
): void {
  const { repoKey, git, cache, buildItems, quickPick, rebuild } = options;
  if (!cache) {
    return;
  }

  const refs = getSelectableRefs(buildItems()).slice(TOP_PREFETCH_COUNT);
  const missingRefs = refs.filter((ref) => cache.isMissing(repoKey, ref));
  if (missingRefs.length === 0) {
    return;
  }

  void refreshRefs({
    repoKey,
    refs: missingRefs,
    git,
    cache,
    concurrency: BACKGROUND_CONCURRENCY,
    onRefUpdated: () => repaintPreservingActive(quickPick, rebuild),
  });
}

export async function refreshRefDetails(
  repoKey: string,
  git: GitExecutor,
  cache: RefDetailsCache | undefined,
  ref: IGitRef
): Promise<Partial<IGitRef> | undefined> {
  const cached = cache?.get(repoKey, ref);
  if (cached) {
    mergeRefDetails(ref, cached);
    return cached;
  }

  const details = await git.getRefDetailsFast(ref);
  if (details && Object.keys(details).length > 0) {
    const originalHash = ref.hash;
    mergeRefDetails(ref, details);
    await cache?.upsert(repoKey, { ...ref, hash: originalHash }, details);
  }
  return details;
}

function getSelectableRefs<T extends EnrichableItem>(items: readonly T[]): IGitRef[] {
  return items
    .map((item) => item.ref)
    .filter((ref): ref is IGitRef => Boolean(ref));
}

async function refreshRefs(options: {
  repoKey: string;
  refs: IGitRef[];
  git: GitExecutor;
  cache: RefDetailsCache;
  concurrency: number;
  onRefUpdated?: (ref: IGitRef) => void;
}): Promise<void> {
  const { refs, concurrency } = options;
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, refs.length) }, async () => {
    while (index < refs.length) {
      const ref = refs[index++];
      await refreshOneRef({ ...options, ref });
    }
  });
  await Promise.all(workers);
}

async function refreshOneRef(options: {
  repoKey: string;
  ref: IGitRef;
  git: GitExecutor;
  cache: RefDetailsCache;
  onRefUpdated?: (ref: IGitRef) => void;
}): Promise<void> {
  const { repoKey, ref, git, cache, onRefUpdated } = options;
  const originalHash = ref.hash;
  let details: Partial<IGitRef> | undefined;
  try {
    details = await git.getRefDetailsFast(ref);
  } catch {
    details = undefined;
  }

  if (!details || Object.keys(details).length === 0) {
    return;
  }

  mergeRefDetails(ref, details);
  await cache.upsert(repoKey, { ...ref, hash: originalHash }, details);
  onRefUpdated?.(ref);
}

function repaintPreservingActive<T extends EnrichableItem>(
  quickPick: vscode.QuickPick<T>,
  rebuild: () => T[]
): void {
  const activeKey = quickPick.activeItems[0]?.ref
    ? getFullRefname(quickPick.activeItems[0].ref)
    : undefined;
  quickPick.items = rebuild();
  if (!activeKey) {
    return;
  }
  const match = quickPick.items.find((item) => item.ref && getFullRefname(item.ref) === activeKey);
  if (match) {
    quickPick.activeItems = [match];
  }
}
