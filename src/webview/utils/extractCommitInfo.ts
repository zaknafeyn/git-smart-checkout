import { GitHubCommit } from '@/types/dataTypes';

export const extractCommitInfo = (commit: GitHubCommit) => {
  const hasFiles = commit.files && commit.files.length > 0;
  const isMergeCommit = commit.parents.length > 1;
  const commitMessage = commit.commit.message.split('\n')[0];
  const fullCommitMessage = commit.commit.message;

  return {
    hasFiles,
    isMergeCommit,
    commitMessage,
    fullCommitMessage,
  };
};
