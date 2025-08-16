import { CommitFileItem } from '@/components/CommitFileItem';
import { GitHubCommit } from '@/types/dataTypes';
import React, { useMemo, useState } from 'react';

import styles from './module.css';
import { extractCommitInfo } from '@/utils/extractCommitInfo';

interface CommitItemProps {
  commit: GitHubCommit;
  isSelected: boolean;
  isCloning: boolean;
  onToggle: (sha: string) => void;
}

export const CommitItem: React.FC<CommitItemProps> = ({
  commit,
  isSelected,
  isCloning,
  onToggle
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const { hasFiles, isMergeCommit, commitMessage, fullCommitMessage } = useMemo(() => extractCommitInfo(commit), [commit])

  const handleToggleSelection = () => {
    if (isCloning) return;
    onToggle(commit.sha);
  };

  const handleToggleExpand = () => {
    if (hasFiles) {
      setIsExpanded(!isExpanded);
    }
  };

  return (
    <div className={`${styles.commitItem}`}>
      <div className={styles.commitHeader}>
        <div className={styles.checkboxContainer}>
          <input
            type="checkbox"
            checked={isSelected}
            onChange={handleToggleSelection}
            disabled={isCloning}
            className={styles.checkbox}
          />
        </div>
        
        <div 
          className={`${styles.commitInfo} ${hasFiles ? styles.clickable : ''}`}
          onClick={handleToggleExpand}
        >
          <div className={styles.commitMessageRow}>
            <span 
              className={styles.commitMessage} 
              title={fullCommitMessage}
            >
              {commitMessage}
            </span>
            {isMergeCommit && (
              <span className={styles.mergeLabel}>MERGE</span>
            )}
          </div>
          
          <div className={styles.commitMeta}>
            <span className={styles.commitSha}>{commit.sha.substring(0, 7)}</span>
            {hasFiles && commit.files && (
              <span className={styles.fileCount}>
                {commit.files.length} file{commit.files.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        {hasFiles && (
          <span className={`${styles.expandIcon} ${isExpanded ? styles.expanded : ''}`}>
            ▶
          </span>
        )}
      </div>

      {isExpanded && hasFiles && commit.files && (
        <div className={styles.filesContainer}>
          {commit.files.map((file, index) => (
            <CommitFileItem
              key={`${commit.sha}-${file.filename}-${index}`}
              file={file}
            />
          ))}
        </div>
      )}
    </div>
  );
};
