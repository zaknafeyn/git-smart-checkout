import React from 'react';

import styles from './module.css';

interface StackTargetChipAheadBehind {
  ahead: number;
  behind: number;
}

interface StackTargetChipProps {
  branch: string;
  isCurrent: boolean;
  /** Ahead/behind vs. the branch's remote-tracking ref; omitted when there's no upstream to compare against. */
  aheadBehind?: StackTargetChipAheadBehind;
  isFetching?: boolean;
  onCheckout: (branch: string) => void;
  onFetch: () => void;
}

export const StackTargetChip: React.FC<StackTargetChipProps> = ({
  branch,
  isCurrent,
  aheadBehind,
  isFetching,
  onCheckout,
  onFetch,
}) => {
  return (
    <div className={styles.row}>
      <span className={styles.marker}>
        <span className={styles.markerDot} />
      </span>
      <button
        type="button"
        className={[styles.chip, isCurrent && styles.current].filter(Boolean).join(' ')}
        onClick={() => onCheckout(branch)}
        title={isCurrent ? `${branch} (current)` : `Checkout ${branch}`}
      >
        {branch}
      </button>
      {aheadBehind && (
        <span
          className={styles.aheadBehind}
          title={`${aheadBehind.ahead} commit${aheadBehind.ahead === 1 ? '' : 's'} waiting to be pushed, ${aheadBehind.behind} commit${aheadBehind.behind === 1 ? '' : 's'} to pull from origin`}
        >
          ⇡{aheadBehind.ahead} ⇣{aheadBehind.behind}
        </span>
      )}
      <button
        type="button"
        className={styles.fetchButton}
        onClick={onFetch}
        disabled={isFetching}
        title="Fetch latest changes"
        aria-label="Fetch latest changes"
      >
        <span className={isFetching ? styles.spinning : undefined}>⟳</span>
      </button>
    </div>
  );
};
