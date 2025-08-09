import { GitHubCommitFile } from '@/types/dataTypes';
import React from 'react';

import styles from './CommitFileItem.module.css';

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

  const getStatsString = (): string => {
    const parts = [];
    if (file.additions > 0) {parts.push(`+${file.additions}`);}
    if (file.deletions > 0) {parts.push(`-${file.deletions}`);}
    return parts.join(' ');
  };

  const statusChar = getStatusChar(file.status);
  const statusColor = getStatusColor(file.status);
  const stats = getStatsString();

  return (
    <div className={styles.fileItem}>
      <div className={styles.fileInfo}>
        <span className={`${styles.statusIndicator} ${statusColor}`}>
          {statusChar}
        </span>
        <span className={styles.fileName}>{file.filename}</span>
        {stats && (
          <span className={styles.fileStats}>{stats}</span>
        )}
      </div>
    </div>
  );
};