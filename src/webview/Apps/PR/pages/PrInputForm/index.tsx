import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Text } from '@/components/Text';
import { useLogger } from '@/hooks';
import { useLoadingState } from '@/hooks/useLoadingState';
import React, { useState, useEffect, useRef } from 'react';

import styles from './module.css';

interface PrInputFormProps {
  repoOwner?: string;
  repoName?: string;
  onFetchPR: (prInput: string) => void;
  onCancel: () => void;
}

export const PrInputForm: React.FC<PrInputFormProps> = ({
    repoOwner = 'owner',
    repoName = 'repo',
    onFetchPR,
    onCancel
  }) => {
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
      if (event.key === 'Escape') {
        handleCancel();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [loadPullRequestData.isLoading]);

  const handleCancel = () => {
    if (loadPullRequestData.isLoading) {
      // Cancel the fetch process but don't close panel
      loadPullRequestData.finish();
      logger.info('PR fetch cancelled by user');
      // todo: remove onCancel and send message to provider to cancer running request
      onCancel();
    } else {
      // Close the panel when not fetching
      onCancel();
    }
  };

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
