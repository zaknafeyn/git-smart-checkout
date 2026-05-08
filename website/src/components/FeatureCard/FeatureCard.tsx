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
}: FeatureCardProps) {
  const commandPaletteShortcut = command ? getCommandPaletteShortcut() : undefined;
  const Title = titleLevel === 4 ? 'h4' : 'h3';
  const className = [
    styles.card,
    compact ? styles.compact : '',
    tone ? styles[tone] : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <article className={className}>
      <div className={styles.cardIcon}>{icon}</div>
      <div className={styles.cardBody}>
        <div className={styles.cardTitleRow}>
          <Title className={styles.cardTitle}>{title}</Title>
          {tag && <span className={styles.tag}>{tag}</span>}
        </div>
        <p className={styles.cardDesc}>{description}</p>
      </div>
      {command && (
        <div className={styles.cardCommand}>
          <kbd className={styles.cmdIcon}>{commandPaletteShortcut}</kbd>
          <code>{command}</code>
        </div>
      )}
    </article>
  );
}
