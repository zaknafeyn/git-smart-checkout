import { IGitRef } from './types';

/**
 * Canonical fully-qualified ref name for a ref, e.g.
 *   local branch  -> refs/heads/<name>
 *   remote branch -> refs/remotes/<remote>/<name>
 *   tag           -> refs/tags/<name>
 *
 * Useful as a stable, collision-free key (a local branch and a same-named tag
 * map to different keys).
 */
export const getFullRefname = (ref: IGitRef): string => {
  if (ref.isTag) {
    return `refs/tags/${ref.name}`;
  }
  if (ref.remote) {
    return `refs/remotes/${ref.remote}/${ref.name}`;
  }
  return `refs/heads/${ref.name}`;
};
