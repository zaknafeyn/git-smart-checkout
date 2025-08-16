import { Button } from '@/components/Button';
import { DropDownAction, DropDownButton } from '@/components/DropDownButton';
import { Input } from '@/components/Input';
import { Link } from '@/components/Link';
import { Text } from '@/components/Text';
import { Textarea } from '@/components/Textarea';
import { useLogger } from '@/hooks';
import { GitHubCommit, GitHubPR } from '@/types/dataTypes';
import React, { useEffect, useState } from 'react';

import { WebviewCommand } from '@/types/commands';

import styles from './module.css';
import { useSendMessage } from '@/hooks/useSendMessage';

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
  const [description, setDescription] = useState(() => {
    const result = [
      `[Cloned from PR #${prData.number}](${prData.html_url})`,
      "",
      prData.body || ''
    ]

    return result.join("\n");
  });
  const [selectedCommits, setSelectedCommits] = useState<string[]>([]);

  const logger = useLogger(false);
  const sendMessage = useSendMessage();
  
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
      if (message.command === WebviewCommand.UPDATE_SELECTED_COMMITS) {
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
    
    sendMessage(WebviewCommand.SELECT_TARGET_BRANCH, { branches });
  };

  const handleCancel = () => {
    if (isCloning) return; // Prevent cancel during cloning

    sendMessage(WebviewCommand.HIDE_COMMITS_WEBVIEW);

    onStartOver();
  };

  const handleSubmit = (isDraft: boolean = false) => {
    if (isCloning) return; // Prevent submit during cloning
    
    if (!featureBranch.trim()) {
      alert('Please enter a feature branch name');
      return;
    }
    
    logger.log(`selectedCommits.length = ${selectedCommits.length}`);
    if (selectedCommits.length === 0) {
      alert('Please select at least one commit');
      return;
    }

    // Show confirmation modal
    const isDraftPr = isDraft ? " draft " : " ";
    const confirmationMessage = `Creating a${isDraftPr}clone of PR ${prData.number} "${prData.title}". Do you want to proceed?`;
    const confirmationDetails = `This operation will create a new branch "${featureBranch.trim()}", cherry pick selected commits and open a PR to branch "${targetBranch}"`;
    
    sendMessage(WebviewCommand.SHOW_CONFIRMATION_DIALOG, {
      message: confirmationMessage,
      details: confirmationDetails,
      data: {
        targetBranch,
        featureBranch: featureBranch.trim(),
        description,
        selectedCommits,
        isDraft
      }
    })
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
