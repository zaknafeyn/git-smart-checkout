import React, { useState } from 'react';
import styles from '../styles.module.css';

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
        <div className={styles.inputGroup}>
          <label htmlFor="prInput" className={styles.label}>PR Number or URL:</label>
          <input
            type="text"
            id="prInput"
            className={styles.input}
            value={prInput}
            onChange={(e) => setPrInput(e.target.value)}
            placeholder="e.g., 123 or https://github.com/owner/repo/pull/123"
          />
        </div>
        
        <div className={styles.buttonGroup}>
          <button type="submit" className={styles.button} disabled={!prInput.trim()}>
            Fetch PR Data
          </button>
          <button type="button" className={styles.buttonSecondary} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
};
