import { createHash } from 'crypto';
import { basename } from 'path';

import { GitExecutor } from '../common/git/gitExecutor';

/**
 * Stable, collision-free identifier used to key per-repo preferences.
 *
 * GitHub repos use `<owner>/<repo>` so the key follows the repo across clones.
 * Everything else falls back to the repository path: a short hash keeps unrelated
 * local repos from colliding (the previous `<workspace folder>` / `'default'`
 * fallbacks both shared a bucket across distinct repos).
 */
export const getRepoId = async (git: GitExecutor): Promise<string> => {
  const info = await git.getRepoInfo();
  if (info) {
    return `${info.owner}/${info.repo}`;
  }

  const repoPath = git.repositoryPath;
  if (repoPath) {
    const hash = createHash('sha1').update(repoPath).digest('hex').slice(0, 8);
    return `local:${basename(repoPath)}:${hash}`;
  }

  return 'default';
};
