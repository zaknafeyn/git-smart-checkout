import React from 'react';

import styles from './module.css';

export type StackBadgeKind = 'draft' | 'merged' | 'closed' | 'blocked';

export interface StackBadgeProps {
  kind: StackBadgeKind;
}

const LABEL: Record<StackBadgeKind, string> = {
  draft: 'Draft',
  merged: 'Merged',
  closed: 'Closed',
  blocked: 'Blocked downstack',
};

const CLASS: Record<StackBadgeKind, string> = {
  draft: styles.neutral,
  merged: styles.neutral,
  closed: styles.neutral,
  blocked: styles.warning,
};

export const StackBadge: React.FC<StackBadgeProps> = ({ kind }) => (
  <span className={[styles.badge, CLASS[kind]].join(' ')}>{LABEL[kind]}</span>
);
