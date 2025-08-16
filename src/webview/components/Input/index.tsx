import React from 'react';
import styles from './module.css';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  variant?: 'default' | 'title';
}

export const Input: React.FC<InputProps> = ({ 
  label, 
  variant = 'default', 
  className,
  id,
  ...props 
}) => {
  const inputId = id || `input-${Math.random().toString(36).substring(2, 11)}`;
  const inputClassName = variant === 'title' 
    ? `${styles.titleInput} ${className || ''}` 
    : `${styles.input} ${className || ''}`;

  if (label) {
    return (
      <div className={styles.inputGroup}>
        <label htmlFor={inputId} className={styles.label}>
          {label}
        </label>
        <input
          {...props}
          id={inputId}
          className={inputClassName.trim()}
        />
      </div>
    );
  }

  return (
    <input
      {...props}
      id={inputId}
      className={inputClassName.trim()}
    />
  );
};

export type { InputProps };
