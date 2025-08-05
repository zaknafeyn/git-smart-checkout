import React, { useState, useEffect } from 'react';

import { CommitList } from '@/pages/CommitList';

import {CommitData} from '@/types/dataTypes';

export const CommitsApp: React.FC = () => {
  const [commits, setCommits] = useState<CommitData[]>([]);
  const [selectedCommits, setSelectedCommits] = useState<string[]>([]);

  const handleCommitToggle = (sha: string) => {
    const newSelected = selectedCommits.includes(sha) 
      ? selectedCommits.filter(s => s !== sha)
      : [...selectedCommits, sha];
    
    setSelectedCommits(newSelected);
    
    // Send message to VS Code extension
    if (typeof window !== 'undefined' && (window as any).vscode) {
      (window as any).vscode.postMessage({
        command: 'commitToggle',
        sha: sha
      });
    }
  };

  // Handle messages from VS Code extension
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.command === 'updateCommits') {
        setCommits(message.commits);
        setSelectedCommits(message.selectedCommits || []);
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('message', handleMessage);
      return () => window.removeEventListener('message', handleMessage);
    }
  }, []);

  return (
    <div>
      <CommitList
        commits={commits}
        selectedCommits={selectedCommits}
        onCommitToggle={handleCommitToggle}
      />
    </div>
  );
};
