import React, { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Text } from '@/components/Text';
import { useLogger } from '@/hooks';

import styles from './module.css';

interface PrInputFormProps {
  repoOwner?: string;
  repoName?: string;
  onFetchPR: (prInput: string) => void;
  onCancel: () => void;
  isLoading: boolean;
}

export const PrInputForm: React.FC<PrInputFormProps> = ({
  repoOwner = 'owner',
  repoName = 'repo',
  onFetchPR,
  onCancel,
  isLoading,
}) => {
  const [prInput, setPrInput] = useState('');
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
      if (event.key === 'Escape') {
        handleCancel();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isLoading]);

  const handleCancel = () => {
    if (isLoading) {
      logger.info('PR fetch cancelled by user');
    }
    onCancel();
  };

  const handleSubmit = (e: React.FormEvent) => {
    logger.info('Fetching PR data ...');
    e.preventDefault();
    if (!prInput.trim()) {
      alert('Please enter a PR number or URL');
      return;
    }
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
          placeholder={`e.g., 123 or https://github.com/${repoOwner}/${repoName}/pull/123`}
        />

        <div className={styles.buttonGroup}>
          <Button
            type="button"
            variant="secondary"
            onClick={handleCancel}
          >
            Cancel
          </Button>
          <Button 
            type="submit" 
            variant="primary" 
            loading={isLoading}
            disabled={!prInput.trim()}
          >
            Fetch PR Data
          </Button>
        </div>
      </form>
    </div>
  );
};
