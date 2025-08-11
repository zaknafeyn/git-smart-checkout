import { Button } from '@/components/Button';
import { DropDownAction, DropDownButton } from '@/components/DropDownButton';
import { Input } from '@/components/Input';
import { Link } from '@/components/Link';
import { Text } from '@/components/Text';
import { Textarea } from '@/components/Textarea';
import { useLogger } from '@/hooks';
import { GitHubCommit, GitHubPR } from '@/types/dataTypes';
import React, { useEffect, useState } from 'react';

import styles from './PrCloneForm.module.css';

interface PrCloneFormProps {
  prData: GitHubPR;
  commits: GitHubCommit[];
  branches: string[];
  onClonePR: (data: any) => void;
  onStartOver: () => void;
  selectedTargetBranch?: string;
  defaultTargetBranch?: string;
  isCloning: boolean;
}

export const PrCloneForm: React.FC<PrCloneFormProps> = ({
  prData,
  commits,
  branches,
  onClonePR,
  onStartOver,
  selectedTargetBranch,
  defaultTargetBranch,
  isCloning
}) => {
  const [targetBranch, setTargetBranch] = useState(() => {
    // Use defaultTargetBranch from settings if provided and not empty, otherwise fallback
    if (defaultTargetBranch && defaultTargetBranch.trim()) {
      return defaultTargetBranch;
    }
    return prData.head.ref || branches[0] || 'main';
  });
  const [featureBranch, setFeatureBranch] = useState(`${prData.head.ref}_clone`);
  const [description, setDescription] = useState(prData.body || '');
  const [selectedCommits, setSelectedCommits] = useState<string[]>([]);

  const logger = useLogger(false);
  
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
    if (isCloning) return; // Prevent action during cloning
    
    if (typeof window !== 'undefined' && (window as any).vscode) {
      (window as any).vscode.postMessage({
        command: 'selectTargetBranch',
        branches: branches
      });
    }
  };

  const handleCancel = () => {
    if (isCloning) return; // Prevent cancel during cloning
    
    // Hide commits webview when canceling
    if (typeof window !== 'undefined' && (window as any).vscode) {
      (window as any).vscode.postMessage({
        command: 'hideCommitsWebview'
      });
    }
    onStartOver();
  };

  const handleSubmit = (draft: boolean = false) => {
    if (isCloning) return; // Prevent submit during cloning
    
    if (!featureBranch.trim()) {
      // TODO: remove alert and send command to vscode host to error show notification
      alert('Please enter a feature branch name');
      return;
    }
    
    logger.log(`selectedCommits.length = ${selectedCommits.length}`);
    if (selectedCommits.length === 0) {
      // TODO: remove alert and send command to vscode host to error show notification
      alert('Please select at least one commit');
      return;
    }

    // Show confirmation modal
    const confirmationMessage = `Creating a clone of PR ${prData.number} - ${prData.title}. This operation will create a new branch ${featureBranch.trim()}, cherry pick selected commits and open a PR to branch ${targetBranch}. Do you want to proceed?`;
    
    if (typeof window !== 'undefined' && (window as any).vscode) {
      (window as any).vscode.postMessage({
        command: 'showConfirmationDialog',
        message: confirmationMessage,
        data: {
          targetBranch,
          featureBranch: featureBranch.trim(),
          description,
          selectedCommits,
          isDraft: draft
        }
      });
    }
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
            <Button variant="inputBox" onClick={handleTargetBranchClick} disabled={isCloning}>{targetBranch}</Button>
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
              disabled={isCloning}
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
            disabled={isCloning}
          />
        </div>


        <div className={styles.actions}>
          <Button type="button" variant="secondary" onClick={handleCancel} disabled={isCloning}>
            Cancel
          </Button>
          <DropDownButton 
            actions={dropdownActions}
            defaultActionId="create"
            popupDirection="up"
            loading={isCloning}
          />
        </div>
      </div>
    </div>
  );
};
