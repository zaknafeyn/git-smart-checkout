import React from 'react';

import { StackRow } from '@/components/StackRow';
import { StackTargetChip } from '@/components/StackTargetChip';

import { StackView } from '../../../services/stackModel';

import styles from './module.css';

interface StackListProps {
  view: StackView;
  onCheckout: (branch: string) => void;
  onOpenPr: (prNumber: number) => void;
  onCopyBranchName: (branch: string) => void;
  onFetchTarget: () => void;
  isFetchingTarget?: boolean;
}

export const StackList: React.FC<StackListProps> = ({
  view,
  onCheckout,
  onOpenPr,
  onCopyBranchName,
  onFetchTarget,
  isFetchingTarget,
}) => {
  // Bottom-to-top storage order is rendered top-to-bottom, target last, to
  // match the GitHub stacked-PR widget (newest/tip PR on top).
  const topToBottom = [...view.branches].reverse();

  return (
    <div className={styles.container}>
      {topToBottom.map((branch) => (
        <StackRow
          key={branch.branch}
          branch={branch}
          onCheckout={onCheckout}
          onOpenPr={onOpenPr}
          onCopyBranchName={onCopyBranchName}
        />
      ))}
      <StackTargetChip
        branch={view.target}
        isCurrent={view.targetIsCurrent}
        aheadBehind={view.targetAheadBehind}
        isFetching={isFetchingTarget}
        onCheckout={onCheckout}
        onFetch={onFetchTarget}
      />
    </div>
  );
};
