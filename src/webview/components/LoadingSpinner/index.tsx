import React from 'react';

import styles from './module.css';

export interface LoadingSpinnerProps {
  className?: string;
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({ 
  className = '' 
}) => {
  const spinnerClasses = [
    styles.spinner,
    className
  ].filter(Boolean).join(' ');

  return (
    <span className={spinnerClasses} aria-hidden="true">
      <svg className={styles.spinnerIcon} viewBox="0 0 24 24">
        <circle
          className={styles.spinnerPath}
          cx="12"
          cy="12"
          r="10"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="31.416"
          strokeDashoffset="31.416"
        />
      </svg>
    </span>
  );
};