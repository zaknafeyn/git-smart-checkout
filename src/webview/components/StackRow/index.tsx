import React, { useState } from 'react';

import { ContextMenu, ContextMenuItem } from '@/components/ContextMenu';
import { StackBadge, StackBadgeKind } from '@/components/StackBadge';
import { StackStatusIcon } from '@/components/StackStatusIcon';

import { StackViewBranch } from '../../../services/stackModel';

import styles from './module.css';

interface StackRowProps {
  branch: StackViewBranch;
  onCheckout: (branch: string) => void;
  onOpenPr: (prNumber: number) => void;
  onCopyBranchName: (branch: string) => void;
}

function badgeKind(branch: StackViewBranch): StackBadgeKind | undefined {
  if (branch.pr.blockedDownstack) {
    return 'blocked';
  }
  if (branch.pr.status === 'draft' || branch.pr.status === 'merged' || branch.pr.status === 'closed') {
    return branch.pr.status;
  }
  return undefined;
}

export const StackRow: React.FC<StackRowProps> = ({ branch, onCheckout, onOpenPr, onCopyBranchName }) => {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const handleContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY });
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onCheckout(branch.branch);
    }
  };

  const menuItems: ContextMenuItem[] = [
    { label: 'Open PR in Browser', onSelect: () => onOpenPr(branch.pr.number) },
    { label: 'Checkout branch', onSelect: () => onCheckout(branch.branch) },
    { label: 'Copy branch name', onSelect: () => onCopyBranchName(branch.branch) },
  ];

  const dimmed = branch.pr.status === 'merged' || branch.pr.status === 'closed';
  const badge = badgeKind(branch);

  return (
    <div
      className={[
        styles.row,
        branch.isCurrent && styles.current,
        dimmed && styles.dimmed,
      ].filter(Boolean).join(' ')}
      role="button"
      tabIndex={0}
      onClick={() => onCheckout(branch.branch)}
      onKeyDown={handleKeyDown}
      onContextMenu={handleContextMenu}
    >
      <span className={styles.marker}>
        <StackStatusIcon status={branch.pr.status} blocked={branch.pr.blockedDownstack} />
      </span>
      <div className={styles.content}>
        <div className={styles.titleLine}>
          <span className={styles.title}>{branch.pr.title}</span>
          {badge && <StackBadge kind={badge} />}
        </div>
        <div className={styles.meta}>
          #{branch.pr.number} · {branch.branch}
        </div>
      </div>
      <button
        type="button"
        className={styles.openPr}
        onClick={(event) => {
          event.stopPropagation();
          onOpenPr(branch.pr.number);
        }}
        title="Open PR in browser"
        aria-label="Open PR in browser"
      >
        ↗
      </button>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
    </div>
  );
};
