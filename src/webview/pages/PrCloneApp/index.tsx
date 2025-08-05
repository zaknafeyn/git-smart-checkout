import React, { useState } from 'react';
import { PrInputForm } from '@/pages/PrInputForm';
import { PrCloneForm } from '@/pages/PrCloneForm';
import { AppState } from '@/types/dataTypes';

export const PrCloneApp: React.FC = () => {
  const [state, setState] = useState<AppState>({ view: 'input' });

  const handleFetchPR = (prInput: string) => {
    // TODO: Extract VS Code message posting to utility function - similar pattern used in PrCloneForm/index.tsx:65 and CommitsApp/index.tsx:24
    // Send message to VS Code extension
    if (typeof window !== 'undefined' && (window as any).vscode) {
      (window as any).vscode.postMessage({
        command: 'fetchPR',
        prInput: prInput
      });
    }
  };

  const handleClonePR = (data: any) => {
    // Send message to VS Code extension
    if (typeof window !== 'undefined' && (window as any).vscode) {
      (window as any).vscode.postMessage({
        command: 'clonePR',
        data: data
      });
    }
  };

  const handleCancel = () => {
    // Send message to VS Code extension to close activity bar and hide webview
    if (typeof window !== 'undefined' && (window as any).vscode) {
      (window as any).vscode.postMessage({
        command: 'cancelPRClone'
      });
    }
  };

  const handleStartOver = () => {
    setState({ view: 'input' });
  };

  // TODO: Extract useEffect message handling pattern to custom hook - similar pattern used in PrCloneForm/index.tsx:58 and CommitsApp/index.tsx:42
  // Handle messages from VS Code extension
  React.useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.command === 'showPRData') {
        // Show notification about the fetched PR
        const prData = message.prData;
        const notification = `✅ PR Fetched: #${prData.number} "${prData.title}" from branch "${prData.head.ref}"`;
        
        // Show notification for 3 seconds
        if (typeof window !== 'undefined' && (window as any).vscode) {
          (window as any).vscode.postMessage({
            command: 'showNotification',
            message: notification,
            type: 'info'
          });
        }
        
        setState({
          view: 'clone',
          prData: message.prData,
          commits: message.commits,
          branches: message.branches
        });
      } else if (message.command === 'targetBranchSelected') {
        setState(prev => ({
          ...prev,
          targetBranch: message.branch
        }));
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('message', handleMessage);
      return () => window.removeEventListener('message', handleMessage);
    }
  }, []);

  if (state.view === 'clone' && state.prData && state.commits && state.branches) {
    return (
      <PrCloneForm
        prData={state.prData}
        commits={state.commits}
        branches={state.branches}
        onClonePR={handleClonePR}
        onStartOver={handleStartOver}
        selectedTargetBranch={state.targetBranch}
      />
    );
  }

  return (
    <PrInputForm 
      onFetchPR={handleFetchPR} 
      onCancel={handleCancel}
    />
  );
};