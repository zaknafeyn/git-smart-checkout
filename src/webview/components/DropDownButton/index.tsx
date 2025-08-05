import React from 'react';
import styles from './DropDownButton.module.css';

export interface DropDownButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  dropdownIcon?: string;
}

export const DropDownButton: React.FC<DropDownButtonProps> = ({
  children,
  dropdownIcon = '▼',
  className = '',
  ...props
}) => {
  const buttonClasses = [
    styles.dropdownButton,
    className
  ].filter(Boolean).join(' ');

  return (
    <button
      className={buttonClasses}
      {...props}
    >
      {children}
      <span className={styles.dropdownIcon}>{dropdownIcon}</span>
    </button>
  );
};

export interface DropDownSelectorProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  dropdownIcon?: string;
}

export const DropDownSelector: React.FC<DropDownSelectorProps> = ({
  children,
  dropdownIcon = '▼',
  className = '',
  ...props
}) => {
  const selectorClasses = [
    styles.selector,
    className
  ].filter(Boolean).join(' ');

  return (
    <div
      className={selectorClasses}
      {...props}
    >
      <span>{children}</span>
      <span className={styles.selectorIcon}>{dropdownIcon}</span>
    </div>
  );
};