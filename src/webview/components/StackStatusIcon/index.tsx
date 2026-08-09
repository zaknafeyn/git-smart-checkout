import React from 'react';

import { StackMemberStatus } from '../../../services/prStack';

import styles from './module.css';

export interface StackStatusIconProps {
  status: StackMemberStatus;
  /** Overrides `status` for the "Blocked downstack" case, which isn't a `StackMemberStatus` on its own. */
  blocked?: boolean;
}

const STATUS_CLASS: Record<StackMemberStatus, string> = {
  open: styles.open,
  draft: styles.draft,
  merged: styles.merged,
  closed: styles.closed,
};

/** A GitHub-stack-map-style status glyph. No codicon font is available in this webview, so this is inline SVG (`currentColor`), sized/colored by the wrapping `.icon` class. */
export const StackStatusIcon: React.FC<StackStatusIconProps> = ({ status, blocked }) => {
  const effectiveClass = blocked ? styles.blocked : STATUS_CLASS[status];
  const title = blocked ? 'Blocked downstack' : status[0].toUpperCase() + status.slice(1);

  return (
    <span className={[styles.icon, effectiveClass].join(' ')} title={title} aria-hidden="true">
      <svg viewBox="0 0 16 16" width="14" height="14">
        {blocked ? (
          <>
            <circle cx="8" cy="8" r="6.5" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="1.5" />
            <line x1="4.5" y1="8" x2="11.5" y2="8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          </>
        ) : status === 'merged' ? (
          <>
            <circle cx="8" cy="8" r="6.5" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M5 8.2l2 2 4-4.4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        ) : status === 'closed' ? (
          <>
            <circle cx="8" cy="8" r="6.5" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="1.5" />
            <line x1="5.8" y1="5.8" x2="10.2" y2="10.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <line x1="10.2" y1="5.8" x2="5.8" y2="10.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </>
        ) : status === 'draft' ? (
          <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2.2" />
        ) : (
          <circle cx="8" cy="8" r="6.5" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="1.5" />
        )}
      </svg>
    </span>
  );
};
