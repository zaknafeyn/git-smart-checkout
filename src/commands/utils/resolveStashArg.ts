import { IGitStash } from '../../common/git/types';
import { StashTreeItem } from '../../view/StashTreeDataProvider';

export interface ResolvedStashArg {
  stashes: IGitStash[];
  repositoryPath: string;
}

/**
 * `view/item/context` commands are invoked by VS Code with the clicked tree element as the
 * first argument and — when `canSelectMany` is on and multiple rows are selected — the full
 * selection as the second argument. Normalizes both shapes into the underlying stashes plus
 * the repository they belong to (all selected rows come from the same repository's tree).
 */
export function resolveStashArg(item: unknown, items?: unknown): ResolvedStashArg | undefined {
  const candidates = Array.isArray(items) && items.length > 0 ? items : [item];
  const stashItems = candidates.filter((candidate): candidate is StashTreeItem => candidate instanceof StashTreeItem);

  if (stashItems.length === 0) {
    return undefined;
  }

  return {
    stashes: stashItems.map((stashItem) => stashItem.stash),
    repositoryPath: stashItems[0].repositoryPath,
  };
}
