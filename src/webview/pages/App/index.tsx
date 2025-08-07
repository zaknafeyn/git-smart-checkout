import { useLogger } from '@/hooks';
import { PrCloneForm } from '@/pages/PrCloneForm';
import { PrInputForm } from '@/pages/PrInputForm';
import { AppState } from '@/types/dataTypes';
import React, { useEffect, useState } from 'react';

const STORAGE_KEY = 'pr-clone-app-state';

export const App: React.FC = () => {
  const logger = useLogger(false);
  
  const [state, setState] = useState<AppState>(() => {
    // Initialize state from localStorage on component mount
    try {
      const savedState = localStorage.getItem(STORAGE_KEY);
      logger.debug(`Loading saved app state: ${savedState?.substring(0, 25)}...`);
      if (savedState) {
        return JSON.parse(savedState);
      }
    } catch (error) {
      logger.warn(`Failed to load saved app state: ${error}`);
    }
    return { view: 'input' };
  });

  // Save state to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      logger.warn(`Failed to save app state: ${error}`);
    }
  }, [state]);

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
    logger.info('Starting over ...');
    const newState: AppState = { view: 'input' };
    setState(newState);
    // Clear saved state when starting over
    try {
      logger.info(`Clearing app state from localStorage: ${STORAGE_KEY}`);
      localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      logger.warn(`Failed to clear saved app state: ${error}`);
    }
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
        
        logger.info(`Successfully fetched PR data: #${prData.number} - ${prData.title}`);
        
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
          branches: message.branches,
          defaultTargetBranch: message.defaultTargetBranch
        });
      } else if (message.command === 'targetBranchSelected') {
        setState(prev => ({
          ...prev,
          targetBranch: message.branch
        }));
      } else if (message.command === 'clearState') {
        // Clear state and localStorage when commanded by extension
        handleStartOver();
      } else if (message.command === 'updateLoadingState') {
        setState(prev => ({
          ...prev,
          isCloning: message.isLoading
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
        defaultTargetBranch={state.defaultTargetBranch}
        isCloning={state.isCloning || false}
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
