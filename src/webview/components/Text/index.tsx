import React, { FC, ReactNode } from 'react';
import classNames from 'classnames';

import styles from './Text.module.css';

interface TextProps {
  children: ReactNode;
  className?: string;
}

const Header: FC<TextProps> = ({ children, className }) => {
  const style = classNames(styles.textCommon, styles.textHeader, className);

  return <h2 className={style}>{children}</h2>;
};

const SubHeader: FC<TextProps> = ({ children, className }) => {
  const style = classNames(styles.textCommon, styles.textSubHeader, className);

  return <h3 className={style}>{children}</h3>;
};

const Paragraph: FC<TextProps> = ({ children, className }) => {
  const style = classNames(styles.textCommon, styles.textParagraph, className);

  return <p className={style}>{children}</p>;
};

export const Text = {
  Paragraph,
  Header,
  SubHeader,
};
