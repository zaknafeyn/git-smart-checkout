import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Text } from '@/components/Text';
import { useLogger } from '@/hooks';
import { useLoadingState } from '@/hooks/useLoadingState';
import React, { useState, useEffect, useRef } from 'react';

import styles from './module.css';

interface PrInputFormProps {
  onFetchPR: (prInput: string) => void;
  onCancel: () => void;
}

export const PrInputForm: React.FC<PrInputFormProps> = ({ onFetchPR, onCancel }) => {
  const [prInput, setPrInput] = useState('');
  const loadPullRequestData = useLoadingState();
  const inputRef = useRef<HTMLInputElement>(null);

  const logger = useLogger();

  useEffect(() => {
    // Focus the input field when the component mounts
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loadPullRequestData.isLoading) {
        onCancel();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel, loadPullRequestData.isLoading]);

  const handleSubmit = (e: React.FormEvent) => {
    logger.info('Fetching PR data ...')
    e.preventDefault();
    if (!prInput.trim()) {
      alert('Please enter a PR number or URL');
      return;
    }
    loadPullRequestData.start();
    onFetchPR(prInput.trim());
  };

  return (
    <div>
      <Text.Header>🔄 Clone GitHub PR</Text.Header>

      <form onSubmit={handleSubmit}>
        <Input
          ref={inputRef}
          type="text"
          label="PR Number or URL:"
          value={prInput}
          onChange={(e) => setPrInput(e.target.value)}
          placeholder="e.g., 123 or https://github.com/owner/repo/pull/123"
        />

        <div className={styles.buttonGroup}>
          <Button
            type="button"
            variant="secondary"
            onClick={onCancel}
            disabled={loadPullRequestData.isLoading}
          >
            Cancel
          </Button>
          <Button 
            type="submit" 
            variant="primary" 
            loading={loadPullRequestData.isLoading}
            disabled={!prInput.trim()}
          >
            Fetch PR Data
          </Button>
        </div>
      </form>
    </div>
  );
};
