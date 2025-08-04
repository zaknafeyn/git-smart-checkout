import React from 'react';
import styles from './Textarea.module.css';

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
}

export const Textarea: React.FC<TextareaProps> = ({ 
  label, 
  className,
  id,
  ...props 
}) => {
  const textareaId = id || `textarea-${Math.random().toString(36).substring(2, 11)}`;
  const textareaClassName = `${styles.textarea} ${className || ''}`;

  if (label) {
    return (
      <div className={styles.textareaGroup}>
        <label htmlFor={textareaId} className={styles.label}>
          {label}
        </label>
        <textarea
          {...props}
          id={textareaId}
          className={textareaClassName.trim()}
        />
      </div>
    );
  }

  return (
    <textarea
      {...props}
      id={textareaId}
      className={textareaClassName.trim()}
    />
  );
};