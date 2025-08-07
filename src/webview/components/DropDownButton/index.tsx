import { useLogger } from '@/hooks';
import React, { useEffect, useRef, useState } from 'react';

import styles from './DropDownButton.module.css';

export interface DropDownAction {
  id: string;
  title: string;
  action: () => void;
}

export interface DropDownButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  variant?: 'primary' | 'secondary' | 'icon' | 'inputBox';
  loading?: boolean;
  actions: DropDownAction[];
  defaultActionId?: string;
  dropdownIcon?: string;
  popupDirection?: 'up' | 'down';
}

export const DropDownButton: React.FC<DropDownButtonProps> = ({
  variant = 'primary',
  loading = false,
  disabled,
  className = '',
  actions,
  defaultActionId,
  dropdownIcon = '▼',
  popupDirection = 'down',
  ...props
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedAction, setSelectedAction] = useState<DropDownAction | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const logger = useLogger(false);

  useEffect(() => {
    const defaultAction = defaultActionId 
      ? actions.find(action => action.id === defaultActionId)
      : actions[0];
    setSelectedAction(defaultAction || null);
  }, [actions, defaultActionId]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleMainClick = () => {
    if (selectedAction && !loading && !disabled) {
      selectedAction.action();
    }
  };

  const handleDropdownClick = (e: React.MouseEvent) => {
    logger.info('Click on drop down');
    e.stopPropagation();
    if (!disabled && !loading) {
      setIsOpen(!isOpen);
    }
  };

  const handleActionSelect = (action: DropDownAction) => {
    setSelectedAction(action);
    setIsOpen(false);
  };

  const buttonClasses = [
    styles.dropdownButton,
    styles[variant],
    loading && styles.loading,
    className
  ].filter(Boolean).join(' ');

  const dropdownClasses = [
    styles.dropdownChevron,
    styles[variant],
    loading && styles.loading
  ].filter(Boolean).join(' ');

  return (
    <div className={styles.dropdownContainer} ref={dropdownRef}>
      <div className={styles.buttonGroup}>
        <button
          className={buttonClasses}
          disabled={disabled || loading}
          onClick={handleMainClick}
          {...props}
        >
          {loading && (
            <span className={styles.spinner} aria-hidden="true">
              <svg className={styles.spinnerIcon} viewBox="0 0 24 24">
                <circle
                  className={styles.spinnerPath}
                  cx="12"
                  cy="12"
                  r="10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeDasharray="31.416"
                  strokeDashoffset="31.416"
                />
              </svg>
            </span>
          )}

          {variant === 'inputBox' && (<>{selectedAction?.title}</>)}
          {variant !== 'inputBox' && (
            <span className={loading ? styles.hiddenText : undefined}>
              {selectedAction?.title}
            </span>
          )}
        </button>
        
        <button
          className={dropdownClasses}
          disabled={disabled || loading}
          onClick={handleDropdownClick}
          type="button"
        >
          <span className={styles.dropdownIcon}>{dropdownIcon}</span>
        </button>
      </div>

      {isOpen && (
        <div className={`${styles.dropdownMenu} ${popupDirection === 'up' ? styles.dropdownMenuUp : styles.dropdownMenuDown}`}>
          {actions
            .filter(action => action.id !== selectedAction?.id)
            .map((action) => (
              <button
                key={action.id}
                className={styles.dropdownItem}
                onClick={() => handleActionSelect(action)}
                type="button"
              >
                {action.title}
              </button>
            ))}
        </div>
      )}
    </div>
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
