import { getFullRefname } from '../common/git/refName';
import { IGitRef } from '../common/git/types';
import { PreferredRefsMap, PreferredRefsRepo } from './extensionConfig';

export const emptyPreferredRefs = (): PreferredRefsRepo => ({
  locals: [],
  remotes: [],
  tags: [],
});

/** Preferences for a single repo, or an empty set when none are stored yet. */
export const getRepoPrefs = (
  map: PreferredRefsMap | undefined,
  repoId: string
): PreferredRefsRepo => map?.[repoId] ?? emptyPreferredRefs();

export const isRefPreferred = (prefs: PreferredRefsRepo, ref: IGitRef): boolean => {
  const full = getFullRefname(ref);
  if (ref.isTag) {
    return prefs.tags.includes(full);
  }
  if (ref.remote) {
    return prefs.remotes.includes(full);
  }
  return prefs.locals.includes(full);
};

/**
 * Toggle the preferred state of a ref, returning a new preferences object
 * (the input is left untouched).
 *
 * Local and remote branches that share a name are kept in sync: starring one
 * stars its counterpart, and unstarring one unstars the other. Tags toggle on
 * their own.
 */
export const togglePreferredRef = (
  prefs: PreferredRefsRepo,
  ref: IGitRef,
  existingRefs: IGitRef[]
): PreferredRefsRepo => {
  const next: PreferredRefsRepo = {
    locals: [...prefs.locals],
    remotes: [...prefs.remotes],
    tags: [...prefs.tags],
  };

  const add = (arr: string[], val: string) => {
    if (!arr.includes(val)) {
      arr.push(val);
    }
  };

  const remove = (arr: string[], val: string) => {
    const idx = arr.indexOf(val);
    if (idx >= 0) {
      arr.splice(idx, 1);
    }
  };

  if (ref.isTag) {
    const full = getFullRefname(ref);
    if (next.tags.includes(full)) {
      remove(next.tags, full);
    } else {
      add(next.tags, full);
    }
  } else if (ref.remote) {
    const remoteFull = getFullRefname(ref);
    const localFull = `refs/heads/${ref.name}`;
    const existsLocal = existingRefs.some((r) => !r.remote && !r.isTag && r.name === ref.name);
    if (next.remotes.includes(remoteFull)) {
      remove(next.remotes, remoteFull);
      if (existsLocal) {
        remove(next.locals, localFull);
      }
    } else {
      add(next.remotes, remoteFull);
      if (existsLocal) {
        add(next.locals, localFull);
      }
    }
  } else {
    const localFull = getFullRefname(ref);
    const remoteFulls = existingRefs
      .filter((r) => r.remote && !r.isTag && r.name === ref.name)
      .map((r) => `refs/remotes/${r.remote}/${r.name}`);
    if (next.locals.includes(localFull)) {
      remove(next.locals, localFull);
      remoteFulls.forEach((rf) => remove(next.remotes, rf));
    } else {
      add(next.locals, localFull);
      remoteFulls.forEach((rf) => add(next.remotes, rf));
    }
  }

  return next;
};

/**
 * Drop preferred entries whose full refname is no longer present.
 * Returns the filtered prefs and whether anything changed.
 */
export const cleanupMissingRefs = (
  prefs: PreferredRefsRepo,
  existingFullRefnames: Set<string>
): { prefs: PreferredRefsRepo; changed: boolean } => {
  const filter = (arr: string[]) => arr.filter((full) => existingFullRefnames.has(full));
  const next: PreferredRefsRepo = {
    locals: filter(prefs.locals),
    remotes: filter(prefs.remotes),
    tags: filter(prefs.tags),
  };

  const changed =
    next.locals.length !== prefs.locals.length ||
    next.remotes.length !== prefs.remotes.length ||
    next.tags.length !== prefs.tags.length;

  return { prefs: next, changed };
};

/**
 * Position of a ref within its preferred list (the order it was starred in).
 * Non-preferred refs sort last.
 */
export const preferredOrderIndex = (prefs: PreferredRefsRepo, ref: IGitRef): number => {
  const full = getFullRefname(ref);
  const arr = ref.isTag ? prefs.tags : ref.remote ? prefs.remotes : prefs.locals;
  const idx = arr.indexOf(full);
  return idx < 0 ? Number.MAX_SAFE_INTEGER : idx;
};

/**
 * Stable sort by star order: refs keep the order in which they were starred,
 * with ties (and non-preferred refs) preserving their original order.
 */
export const sortByPreferredOrder = <T extends IGitRef>(
  refs: T[],
  prefs: PreferredRefsRepo
): T[] =>
  refs
    .map((ref, index) => ({ ref, index, order: preferredOrderIndex(prefs, ref) }))
    .sort((a, b) => a.order - b.order || a.index - b.index)
    .map((entry) => entry.ref);
