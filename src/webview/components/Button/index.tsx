import React from 'react';

import { LoadingSpinner } from '@/components/LoadingSpinner';

import styles from './module.css';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'icon' | 'inputBox';
  loading?: boolean;
  children: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  loading = false,
  disabled,
  className = '',
  children,
  ...props
}) => {
  const buttonClasses = [
    styles.button,
    styles[variant],
    loading && styles.loading,
    className
  ].filter(Boolean).join(' ');

  return (
    <button
      className={buttonClasses}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <LoadingSpinner />}

      {variant === 'inputBox' && (<>{ children }</>)}
      {variant !== 'inputBox' && (
        <span className={loading ? styles.hiddenText : undefined}>
          {children}
        </span>
      )}
      
    </button>
  );
};