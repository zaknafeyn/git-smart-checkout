import React, { useState } from 'react';
import styles from './PrInputForm.module.css';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';

interface PrInputFormProps {
  onFetchPR: (prInput: string) => void;
  onCancel: () => void;
}

export const PrInputForm: React.FC<PrInputFormProps> = ({ onFetchPR, onCancel }) => {
  const [prInput, setPrInput] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prInput.trim()) {
      alert('Please enter a PR number or URL');
      return;
    }
    onFetchPR(prInput.trim());
  };

  return (
    <div>
      <h2>🔄 Clone GitHub PR</h2>
      
      <form onSubmit={handleSubmit}>
        <Input
          type="text"
          label="PR Number or URL:"
          value={prInput}
          onChange={(e) => setPrInput(e.target.value)}
          placeholder="e.g., 123 or https://github.com/owner/repo/pull/123"
        />
        
        <div className={styles.buttonGroup}>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!prInput.trim()}>
            Fetch PR Data
          </Button>
        </div>
      </form>
    </div>
  );
};
