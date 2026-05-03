import { FC, ReactNode } from "react";
import classNames from "classnames";

import styles from './module.css';

interface LinkProps {
  children: ReactNode,
  url: string,
  className?: string,
  tooltipText?: string
}

function getSafeUrl(url: string): string {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:' ? url : '#';
  } catch {
    return '#';
  }
}

export const Link: FC<LinkProps> = ({ children, url, className, tooltipText }) => {
  const style = classNames(styles.link, className)
  return (
    <a
      href={getSafeUrl(url)}
      target="_blank"
      rel="noopener noreferrer"
      className={style}
      title={tooltipText}
    >
      {children}
    </a>
  )
}
