import React, { useEffect, useState } from 'react';

import { useLogger } from '@/hooks';
import { PrCloneForm } from '@/Apps/PR/pages/PrCloneForm';
import { PrInputForm } from '@/Apps/PR/pages/PrInputForm';
import { AppState } from '@/types/dataTypes';
import { WebviewCommand } from '@/types/commands';
import { getVsCodeApi, useSendMessage } from '@/hooks/useSendMessage';
import {
  readWebviewState,
  writeWebviewState,
} from '../../../../common/vscode/webviewState';

import {
  FETCH_PR_LOADING_TIMEOUT,
  FetchPRLoadingAction,
  fetchPRLoadingReducer,
} from './fetchPRLoadingState';

const FETCH_PR_RESPONSE_TIMEOUT_MS = 30_000;

export const App: React.FC = () => {
  const logger = useLogger(false);
  const sendMessage = useSendMessage();
  const vscode = getVsCodeApi<AppState>();
  const fetchPRTimeoutRef = React.useRef<number | undefined>(undefined);

  const [isFetchingPR, updateFetchPRLoading] = React.useReducer(
    fetchPRLoadingReducer,
    false
  );

  const [state, setState] = useState<AppState>(() => {
    try {
      const savedState = readWebviewState(vscode, { view: 'input' });
      logger.debug(`Loading saved app state: ${savedState.view}`);
      return savedState;
    } catch (error) {
      logger.warn(`Failed to load saved app state: ${error}`);
    }
    return { view: 'input' };
  });

  const [repoInfo, setRepoInfo] = useState({
    repo: 'repo',
    owner: 'owner'
  });

  const clearFetchPRTimeout = React.useCallback(() => {
    if (fetchPRTimeoutRef.current !== undefined) {
      window.clearTimeout(fetchPRTimeoutRef.current);
      fetchPRTimeoutRef.current = undefined;
    }
  }, []);

  const updateFetchPRState = React.useCallback(
    (action: FetchPRLoadingAction) => {
      if (action !== WebviewCommand.FETCH_PR) {
        clearFetchPRTimeout();
      }
      updateFetchPRLoading(action);
    },
    [clearFetchPRTimeout]
  );

  useEffect(() => {
    return clearFetchPRTimeout;
  }, [clearFetchPRTimeout]);

  useEffect(() => {
    try {
      writeWebviewState(vscode, state);
    } catch (error) {
      logger.warn(`Failed to save app state: ${error}`);
    }
  }, [state, vscode, logger]);

  const handleFetchPR = (prInput: string) => {
    clearFetchPRTimeout();
    updateFetchPRLoading(WebviewCommand.FETCH_PR);

    try {
      sendMessage(WebviewCommand.FETCH_PR, { prInput });
      fetchPRTimeoutRef.current = window.setTimeout(() => {
        logger.warn('Timed out waiting for PR fetch response');
        fetchPRTimeoutRef.current = undefined;
        updateFetchPRLoading(FETCH_PR_LOADING_TIMEOUT);
      }, FETCH_PR_RESPONSE_TIMEOUT_MS);
    } catch (error) {
      logger.error(`Failed to request PR data: ${error}`);
      updateFetchPRLoading(WebviewCommand.FETCH_PR_ERROR);
    }
  };

  const handleClonePR = (data: any) => {
    // Send message to VS Code extension
    sendMessage(WebviewCommand.CLONE_PR, { data });
  };

  const handleCancel = () => {
    updateFetchPRState(WebviewCommand.CANCEL_PR_CLONE);
    // Send message to VS Code extension to close activity bar and hide webview
    sendMessage(WebviewCommand.CANCEL_PR_CLONE);
  };

  const handleStartOver = React.useCallback(() => {
    logger.info('Starting over ...');
    const newState: AppState = { view: 'input', isCloning: false };
    setState(newState);
  }, [logger]);

  // Handle messages from VS Code extension
  React.useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      logger.debug(`[PrApp] Received message: ${message.command}`);

      switch (true) {
        case message.command === WebviewCommand.SHOW_PR_DATA:
          updateFetchPRState(WebviewCommand.SHOW_PR_DATA);
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
            defaultTargetBranch: message.defaultTargetBranch,
            prBranchPrefix: message.prBranchPrefix,
            prTemplate: message.prTemplate
          });
          break;
        case message.command === WebviewCommand.FETCH_PR_ERROR:
          updateFetchPRState(WebviewCommand.FETCH_PR_ERROR);
          break;
        case message.command === WebviewCommand.TARGET_BRANCH_SELECTED:
          setState(prev => ({
            ...prev,
            targetBranch: message.branch
          }));
          break;
        case message.command === WebviewCommand.CLEAR_STATE:
          handleStartOver();
          break;
        case message.command === WebviewCommand.UPDATE_CLONING_STATE:
          setState(prev => ({
            ...prev,
            isCloning: message.isCloning
          }));
          break;
        case message.command === WebviewCommand.UPDATE_REPO_INFO:
          setRepoInfo(prev => ({
            ...prev,
            ...message.repoInfo
          }));
          break;
        default:
          break;
      };
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('message', handleMessage);
      
      // Signal that webview is ready to receive state
      sendMessage(WebviewCommand.WEBVIEW_READY);

      return () => window.removeEventListener('message', handleMessage);
    }
  }, [handleStartOver, logger, sendMessage, updateFetchPRState]);

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
        prBranchPrefix={state.prBranchPrefix}
        prTemplate={state.prTemplate}
        isCloning={state.isCloning || false}
      />
    );
  }

  return (
    <PrInputForm 
      repoName={repoInfo.repo}
      repoOwner={repoInfo.owner}
      onFetchPR={handleFetchPR}
      onCancel={handleCancel}
      isLoading={isFetchingPR}
    />
  );
};
