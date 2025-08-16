import { useLogger } from '@/hooks';
import { PrCloneForm } from '@/Apps/PR/pages/PrCloneForm';
import { PrInputForm } from '@/Apps/PR/pages/PrInputForm';
import { AppState } from '@/types/dataTypes';
import React, { useEffect, useState } from 'react';

import { WebviewCommand } from '@/types/commands';
import { useSendMessage } from '@/hooks/useSendMessage';

const STORAGE_KEY = 'pr-clone-app-state';

export const App: React.FC = () => {
  const logger = useLogger(false);
  const sendMessage = useSendMessage();
  
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
    sendMessage(WebviewCommand.FETCH_PR, { prInput } )
  };

  const handleClonePR = (data: any) => {
    // Send message to VS Code extension
    sendMessage(WebviewCommand.CLONE_PR, { data });
  };

  const handleCancel = () => {
    // Send message to VS Code extension to close activity bar and hide webview
    sendMessage(WebviewCommand.CANCEL_PR_CLONE);
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

  // Handle messages from VS Code extension
  React.useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;

      switch (true) {
        case message.command === WebviewCommand.SHOW_PR_DATA:
          // Show notification about the fetched PR
          const prData = message.prData;
          
          logger.info(`Successfully fetched PR data: #${prData.number} - ${prData.title}`);

          // const notification = `✅ PR Fetched: #${prData.number} "${prData.title}" from branch "${prData.head.ref}"`;
          
          // // Show notification
          // sendMessage(WebviewCommand.SHOW_NOTIFICATION, {
          //   message: notification,
          //   type: 'info',
          //   items: ["OK"]
          // });
          
          setState({
            view: 'clone',
            prData: message.prData,
            commits: message.commits,
            branches: message.branches,
            defaultTargetBranch: message.defaultTargetBranch
          });
          break;
        case message.command === WebviewCommand.TARGET_BRANCH_SELECTED:
          setState(prev => ({
            ...prev,
            targetBranch: message.branch
          }));
          break;
        case message.command === WebviewCommand.CLEAR_STATE:
          // Clear state and localStorage when commanded by extension
          handleStartOver();
          break;
        case message.command === WebviewCommand.UPDATE_LOADING_STATE:
          setState(prev => ({
            ...prev,
            isCloning: message.isLoading
          }));
          break;
        default:
          break;
      };
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
