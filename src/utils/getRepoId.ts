import { GitExecutor } from '../common/git/gitExecutor';
import { getWorkspaceFoldersFormatted } from '../common/vscode';

export const getRepoId = async (git: GitExecutor): Promise<string> => {
  const info = await git.getRepoInfo();
  if (info) {
    return `${info.owner}/${info.repo}`;
  }

  const wsf = getWorkspaceFoldersFormatted();
  if (wsf && wsf.length > 0) {
    return wsf[0].name;
  }

  return 'default';
};


