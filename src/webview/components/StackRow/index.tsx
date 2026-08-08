import React, { useState } from 'react';

import { ContextMenu, ContextMenuItem } from '@/components/ContextMenu';

import { StackViewBranch } from '../../../services/stackModel';

import styles from './module.css';

interface StackRowProps {
  branch: StackViewBranch;
  onCheckout: (branch: string) => void;
  onOpenPr: (prNumber: number) => void;
  onCopyBranchName: (branch: string) => void;
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

  const dotClass = branch.pr.draft ? styles.draft : styles.open;

  const menuItems: ContextMenuItem[] = [
    { label: 'Open PR in Browser', onSelect: () => onOpenPr(branch.pr.number) },
    { label: 'Checkout branch', onSelect: () => onCheckout(branch.branch) },
    { label: 'Copy branch name', onSelect: () => onCopyBranchName(branch.branch) },
  ];

  return (
    <div
      className={[styles.row, branch.isCurrent && styles.current].filter(Boolean).join(' ')}
      role="button"
      tabIndex={0}
      onClick={() => onCheckout(branch.branch)}
      onKeyDown={handleKeyDown}
      onContextMenu={handleContextMenu}
    >
      <span className={styles.marker}>
        <span className={[styles.dot, dotClass].filter(Boolean).join(' ')} />
      </span>
      <div className={styles.content}>
        <div className={styles.title}>{branch.pr.title}</div>
        <div className={styles.meta}>
          <span>
            #{branch.pr.number} · {branch.branch}
          </span>
          {branch.pr.draft && <span className={styles.draftBadge}>Draft</span>}
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
