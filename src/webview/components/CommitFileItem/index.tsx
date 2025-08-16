import { GitHubCommitFile } from '@/types/dataTypes';
import React from 'react';

import styles from './module.css';

interface CommitFileItemProps {
  file: GitHubCommitFile;
}

export const CommitFileItem: React.FC<CommitFileItemProps> = ({ file }) => {
  const getStatusChar = (status: string): string => {
    switch (status) {
      case 'added': return 'A';
      case 'modified': return 'M';
      case 'removed': return 'D';
      case 'renamed': return 'R';
      default: return 'M';
    }
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'added': return styles.statusAdded;
      case 'modified': return styles.statusModified;
      case 'removed': return styles.statusRemoved;
      case 'renamed': return styles.statusRenamed;
      default: return styles.statusModified;
    }
  };

  const renderStats = () => {
    if (file.additions === 0 && file.deletions === 0) return null;
    
    return (
      <span className={styles.fileStats}>
        {file.additions > 0 && (
          <span className={styles.additions}>+{file.additions}</span>
        )}
        {file.deletions > 0 && (
          <span className={styles.deletions}>-{file.deletions}</span>
        )}
      </span>
    );
  };

  const statusChar = getStatusChar(file.status);
  const statusColor = getStatusColor(file.status);

  return (
    <div className={styles.fileItem}>
      <div className={styles.fileInfo}>
        <span className={`${styles.statusIndicator} ${statusColor}`}>
          {statusChar}
        </span>
        <span className={styles.fileName}>{file.filename}</span>
        {renderStats()}
      </div>
    </div>
  );
};