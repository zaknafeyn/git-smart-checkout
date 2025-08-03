import React from 'react';
import styles from './Button.module.css';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'icon';
  children: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  className = '',
  children,
  ...props
}) => {
  const buttonClasses = [
    styles.button,
    styles[variant],
    className
  ].filter(Boolean).join(' ');

  return (
    <button
      className={buttonClasses}
      {...props}
    >
      {children}
    </button>
  );
};
