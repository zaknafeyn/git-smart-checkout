import { FC, ReactNode } from "react";
import classNames from "classnames";

import styles from './Link.module.css'

interface LinkProps {
  children: ReactNode,
  url: string,
  className?: string,
  tooltipText?: string
}

export const Link: FC<LinkProps> = ({ children, url, className, tooltipText }) => {
  const style = classNames(styles.link, className)
  return (
    <a 
      href={url} 
      target="_blank" 
      rel="noopener noreferrer"
      className={style}
      title={tooltipText}
    >
      {children}
    </a>
  )
}
