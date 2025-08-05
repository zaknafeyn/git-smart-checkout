import { FC, ReactNode } from "react";
import classNames from "classnames";

import styles from './Link.module.css'

interface LinkProps {
  children: ReactNode,
  url: string,
  className?: string
}

export const Link: FC<LinkProps> = ({ children, url, className }) => {
  const style = classNames(styles.link, className)
  return (
    <a 
      href={url} 
      target="_blank" 
      rel="noopener noreferrer"
      className={style}
    >
      {children}
    </a>
  )
}
