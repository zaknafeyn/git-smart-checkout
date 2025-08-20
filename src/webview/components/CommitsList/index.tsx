import { CommitItem } from '@/components/CommitItem';
import { GitHubCommit } from '@/types/dataTypes';
import React from 'react';

import styles from './module.css';

interface CommitsListProps {
  commits: GitHubCommit[];
  selectedCommits: string[];
  isCloning: boolean;
  onToggleCommit: (sha: string) => void;
}

export const CommitsList: React.FC<CommitsListProps> = ({
  commits,
  selectedCommits,
  isCloning,
  onToggleCommit
}) => {
  if (commits.length === 0) {
    return (
      <div className={styles.emptyState}>
        <p>No commits available</p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {commits.map((commit) => (
        <CommitItem
          key={commit.sha}
          commit={commit}
          isSelected={selectedCommits.includes(commit.sha)}
          isCloning={isCloning}
          onToggle={onToggleCommit}
        />
      ))}
    </div>
  );
};