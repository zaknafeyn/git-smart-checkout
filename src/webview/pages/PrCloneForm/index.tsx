import React, { useState, useEffect } from 'react';

import { Button } from '@/components/Button';
import { DropDownButton, DropDownAction } from '@/components/DropDownButton';
import { Input } from '@/components/Input';
import { Textarea } from '@/components/Textarea';
import { GitHubPR, GitHubCommit } from '@/types/dataTypes';

import styles from './PrCloneForm.module.css';
import { Text } from '@/components/Text';
import { Link } from '@/components/Link';

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

  // Listen for updates from commits webview
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.command === 'updateSelectedCommits') {
        setSelectedCommits(message.selectedCommits || []);
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('message', handleMessage);
      return () => window.removeEventListener('message', handleMessage);
    }
  }, []);

  const handleTargetBranchClick = () => {
    if (typeof window !== 'undefined' && (window as any).vscode) {
      (window as any).vscode.postMessage({
        command: 'selectTargetBranch',
        branches: branches
      });
    }
  };

  const handleCancel = () => {
    // Hide commits webview when canceling
    if (typeof window !== 'undefined' && (window as any).vscode) {
      (window as any).vscode.postMessage({
        command: 'hideCommitsWebview'
      });
    }
    onStartOver();
  };

  const handleSubmit = (draft: boolean = false) => {
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
      selectedCommits,
      isDraft: draft
    });
  };

  const dropdownActions: DropDownAction[] = [
    {
      id: 'create',
      title: 'Create',
      action: () => handleSubmit(false)
    },
    {
      id: 'draft',
      title: 'Draft',
      action: () => handleSubmit(true)
    }
  ];

  return (
    <div className={styles.container}>
      
      <div>
        <Text.Label className={styles.prInfo}>
          Cloning Pull Request{' '} 
          <Link url={prData.html_url} tooltipText={prData.title}>#{prData.number}</Link>
        </Text.Label>
      </div>
      
      <div>
        <div className={styles.branchRow}>
          <span className={styles.branchIcon}>🏠</span>
          <Text.Label className={styles.branchLabel}>BASE</Text.Label>
          <div className={styles.branchName}>
            <Button variant="inputBox" onClick={handleTargetBranchClick}>{targetBranch}</Button>
          </div>
        </div>
        <div className={styles.branchRow}>
          <span className={styles.branchIcon}>↪</span>
          <Text.Label className={styles.branchLabel}>BRANCH NAME</Text.Label>
          <div className={styles.branchName}>
            <Input
              type="text"
              value={featureBranch}
              onChange={(e) => setFeatureBranch(e.target.value)}
              placeholder="Feature branch name"
            />
          </div>
        </div>
      </div>

      <div className={styles.form}>

        <div className={styles.inputField}>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description"
            rows={10}
          />
        </div>


        <div className={styles.actions}>
          <Button type="button" variant="secondary" onClick={handleCancel}>
            Cancel
          </Button>
          <DropDownButton 
            actions={dropdownActions}
            defaultActionId="create"
            popupDirection="up"
          />
        </div>
      </div>
    </div>
  );
};
