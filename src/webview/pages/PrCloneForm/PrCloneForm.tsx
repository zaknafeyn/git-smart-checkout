import React, { useState, useEffect } from 'react';
import { CommitList } from '../CommitList';
import styles from './PrCloneForm.module.css';
import { Button } from '../../components/Button';
import { DropDownButton, DropDownSelector } from '../../components/DropDownButton';

interface GitHubPR {
  number: number;
  title: string;
  body: string;
  head: {
    ref: string;
    sha: string;
  };
  base: {
    ref: string;
  };
  html_url: string;
}

interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
  };
  parents: { sha: string }[];
}

interface PrCloneFormProps {
  prData: GitHubPR;
  commits: GitHubCommit[];
  branches: string[];
  onClonePR: (data: any) => void;
  onStartOver: () => void;
  selectedTargetBranch?: string;
}

export const PrCloneForm: React.FC<PrCloneFormProps> = ({
  prData,
  commits,
  branches,
  onClonePR,
  onStartOver,
  selectedTargetBranch
}) => {
  const [targetBranch, setTargetBranch] = useState(prData.head.ref || branches[0] || 'main');
  const [featureBranch, setFeatureBranch] = useState(`${prData.head.ref}_clone`);
  const [description, setDescription] = useState(prData.body || '');
  const [selectedCommits, setSelectedCommits] = useState<string[]>([]);

  useEffect(() => {
    const nonMergeCommits = commits
      .filter(commit => commit.parents.length <= 1)
      .map(commit => commit.sha);
    setSelectedCommits(nonMergeCommits);
  }, [commits]);

  useEffect(() => {
    if (selectedTargetBranch) {
      setTargetBranch(selectedTargetBranch);
    }
  }, [selectedTargetBranch]);

  const handleCommitToggle = (sha: string) => {
    setSelectedCommits(prev => 
      prev.includes(sha) 
        ? prev.filter(s => s !== sha)
        : [...prev, sha]
    );
  };

  const handleTargetBranchClick = () => {
    if (typeof window !== 'undefined' && (window as any).vscode) {
      (window as any).vscode.postMessage({
        command: 'selectTargetBranch',
        branches: branches
      });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!featureBranch.trim()) {
      alert('Please enter a feature branch name');
      return;
    }
    
    if (selectedCommits.length === 0) {
      alert('Please select at least one commit');
      return;
    }
    
    onClonePR({
      targetBranch,
      featureBranch: featureBranch.trim(),
      description,
      selectedCommits
    });
  };

  const commitData = commits.map(commit => ({
    sha: commit.sha,
    message: commit.commit.message.split('\n')[0],
    isMergeCommit: commit.parents.length > 1
  }));

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2 className={styles.createTitle}>▼ CREATE</h2>
      </div>
      
      <div className={styles.branchInfo}>
        <div className={styles.branchRow}>
          <span className={styles.branchIcon}>🏠</span>
          <span className={styles.branchLabel}>BASE</span>
          <span className={styles.branchName}>{targetBranch}</span>
        </div>
        <div className={styles.branchRow}>
          <span className={styles.branchIcon}>↪</span>
          <span className={styles.branchLabel}>MERGE</span>
          <span className={styles.branchName}>{featureBranch}</span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className={styles.form}>
        <div className={styles.inputField}>
          <input
            type="text"
            className={styles.titleInput}
            value={featureBranch}
            onChange={(e) => setFeatureBranch(e.target.value)}
            placeholder="Feature branch name"
          />
          <Button type="button" variant="icon">
            ⚙️
          </Button>
        </div>

        <div className={styles.inputField}>
          <DropDownSelector onClick={handleTargetBranchClick}>
            {targetBranch}
          </DropDownSelector>
        </div>

        <div className={styles.inputField}>
          <textarea
            className={styles.descriptionInput}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description"
            rows={10}
          />
        </div>

        <CommitList
          commits={commitData}
          selectedCommits={selectedCommits}
          onCommitToggle={handleCommitToggle}
        />

        <div className={styles.actions}>
          <Button type="button" variant="secondary" onClick={onStartOver}>
            Cancel
          </Button>
          <DropDownButton type="submit">
            Create
          </DropDownButton>
        </div>
      </form>
    </div>
  );
};
