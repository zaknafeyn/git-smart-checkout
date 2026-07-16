import type { ReactNode } from 'react';

import { getCommandPaletteShortcut } from '../../utils/shortcuts';
import styles from './FeatureCard.module.css';

export type FeatureCardTone = 'blue' | 'green' | 'purple' | 'orange';

interface FeatureCardProps {
  icon: string;
  title: string;
  description: ReactNode;
  command?: string;
  tag?: string;
  tone?: FeatureCardTone;
  compact?: boolean;
  titleLevel?: 3 | 4;
  onClick?: () => void;
}

export function FeatureCard({
  icon,
  title,
  description,
  command,
  tag,
  tone,
  compact = false,
  titleLevel = 3,
  onClick,
}: FeatureCardProps) {
  const commandPaletteShortcut = command ? getCommandPaletteShortcut() : undefined;
  const Title = titleLevel === 4 ? 'h4' : 'h3';
  const className = [
    styles.card,
    compact ? styles.compact : '',
    tone ? styles[tone] : '',
    onClick ? styles.clickable : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <article className={className}>
      <div className={styles.cardIcon}>{icon}</div>
      <div className={styles.cardBody}>
        <div className={styles.cardTitleRow}>
          <Title className={styles.cardTitle}>
            {onClick ? (
              <button
                type="button"
                className={styles.cardButton}
                onClick={onClick}
                aria-haspopup="dialog"
              >
                {title}
              </button>
            ) : (
              title
            )}
          </Title>
          {tag && <span className={styles.tag}>{tag}</span>}
        </div>
        <p className={styles.cardDesc}>{description}</p>
      </div>
      {command && (
        <div className={styles.cardCommand} title={command}>
          <kbd className={styles.cmdIcon}>{commandPaletteShortcut}</kbd>
          <code title={command}>{command}</code>
        </div>
      )}
    </article>
  );
}
