import classNames from 'classnames';
import { FC } from 'react';

import { renderMarkdown } from '@/utils/renderMarkdown';

import styles from './module.css';

interface MarkdownPreviewProps {
  markdown: string;
  className?: string;
}

export const MarkdownPreview: FC<MarkdownPreviewProps> = ({ markdown, className }) => {
  const classes = classNames(styles.preview, className);

  if (!markdown.trim()) {
    return (
      <div className={classes}>
        <span className={styles.empty}>Nothing to preview</span>
      </div>
    );
  }

  return (
    <div className={classes} dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }} />
  );
};
