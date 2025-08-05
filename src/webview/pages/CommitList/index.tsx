import React from 'react';
import styles from './CommitList.module.css';

interface Commit {
  sha: string;
  message: string;
  isMergeCommit: boolean;
}

interface CommitListProps {
  commits: Commit[];
  selectedCommits: string[];
  onCommitToggle: (sha: string) => void;
}

export const CommitList: React.FC<CommitListProps> = ({
  commits,
  selectedCommits,
  onCommitToggle
}) => {
  return (
    <div className={styles.inputGroup}>
      <label className={styles.label}>Select Commits to Cherry-pick:</label>
      <div className={styles.commitsSection}>
        {commits.map((commit) => (
          <div key={commit.sha} className={styles.commitItem}>
            <input
              type="checkbox"
              id={`commit-${commit.sha}`}
              className={styles.commitCheckbox}
              checked={selectedCommits.includes(commit.sha)}
              onChange={() => onCommitToggle(commit.sha)}
            />
            <label htmlFor={`commit-${commit.sha}`} className={styles.commitLabel}>
              <code className={styles.code}>{commit.sha.substring(0, 7)}</code>
              <span className={styles.commitMessage}>{commit.message}</span>
              {commit.isMergeCommit && (
                <span className={styles.mergeBadge}>MERGE</span>
              )}
            </label>
          </div>
        ))}
      </div>
    </div>
  );
};

export type { Commit, CommitListProps };