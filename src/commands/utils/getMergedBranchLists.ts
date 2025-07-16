import { IGitRef } from '../../common/git/types';

export const getMergedBranchLists = (
  branchList: IGitRef[],
  currentBranch: string
): [local: IGitRef[], remote: IGitRef[]] => {
  const branches = branchList.filter((b) => !b.isTag && b.name !== currentBranch);

  const locals = branches.filter((b) => !b.remote);
  const remotes = branches.filter((b) => b.remote);

  return [locals, remotes];
};
