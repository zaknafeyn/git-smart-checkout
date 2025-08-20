import { Button } from '@/components/Button';
import { CommitsList } from '@/components/CommitsList';
import { useLogger } from '@/hooks';
import { GitHubCommit } from '@/types/dataTypes';
import React, { useCallback, useEffect, useState } from 'react';

import { WebviewCommand } from '@/types/commands';

import styles from './module.css';
import { useSendMessage } from '@/hooks/useSendMessage';

interface CommitsAppState {
  commits: GitHubCommit[];
  selectedCommits: string[];
  isCloning: boolean;
}

export const CommitsApp: React.FC = () => {
  const logger = useLogger(false);
  const sendMessage = useSendMessage()
  
  const [state, setState] = useState<CommitsAppState>({
    commits: [],
    selectedCommits: [],
    isCloning: false
  });

  const handleToggleCommit = (sha: string) => {
    if (state.isCloning) {
      logger.warn('Cannot toggle commit during cloning process');
      return;
    }
    
    logger.info(`Toggling commit: ${sha}`);
    sendMessage(WebviewCommand.TOGGLE_COMMIT, { sha });
  };

  const handleSelectAllCommits = () => {
    if (state.isCloning) {
      logger.warn('Cannot select all commits during cloning process');
      return;
    }
    
    logger.info('Selecting all commits');
    sendMessage(WebviewCommand.SELECT_ALL_COMMITS);
  };

  const handleDeselectAllCommits = () => {
    if (state.isCloning) {
      logger.warn('Cannot deselect all commits during cloning process');
      return;
    }
    
    logger.info('Deselecting all commits');
    sendMessage(WebviewCommand.DESELECT_ALL_COMMITS);
  };

  const handleCopyCommitsToClipboard = () => {
    logger.info('Copying commits to clipboard');
    sendMessage(WebviewCommand.COPY_COMMITS_TO_CLIPBOARD);
  };

  // Handle messages from VS Code extension
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      logger.debug(`[CommitsApp] Received message: ${message.command}`);
      
      if (message.command === WebviewCommand.UPDATE_COMMITS) {
        setState({
          commits: message.commits || [],
          selectedCommits: message.selectedCommits || [],
          isCloning: message.isCloning || false
        });
      }

      if (message.command === WebviewCommand.UPDATE_CLONING_STATE) {
        setState(prev => ({
          ...prev,
          isCloning: message.isCloning
        }));
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('message', handleMessage);
      
      // Signal that webview is ready to receive state
      sendMessage(WebviewCommand.WEBVIEW_READY);
      
      return () => window.removeEventListener('message', handleMessage);
    }
  }, [logger, sendMessage]);

  const hasSelectedCommits = state.selectedCommits.length > 0;
  const hasCommits = state.commits.length > 0;

  return (
    <div className={styles.container}>
      {hasCommits && (
        <div className={styles.toolbar}>
          <Button 
            variant="secondary" 
            onClick={handleSelectAllCommits}
            disabled={state.isCloning}
            title="Select All Commits"
          >
            Select All
          </Button>
          <Button 
            variant="secondary" 
            onClick={handleDeselectAllCommits}
            disabled={state.isCloning}
            title="Deselect All Commits"
          >
            Unselect All
          </Button>
          <Button 
            variant="secondary" 
            onClick={handleCopyCommitsToClipboard}
            disabled={state.isCloning}
            title="Copy Commits to Clipboard"
          >
            Copy Commits
          </Button>
        </div>
      )}

      {hasCommits ? (
        <CommitsList
          commits={state.commits}
          selectedCommits={state.selectedCommits}
          isCloning={state.isCloning}
          onToggleCommit={handleToggleCommit}
        />
      ) : (
        <div className={styles.emptyState}>
          <p>No commits to display. Fetch a PR first.</p>
        </div>
      )}

      {!hasSelectedCommits && hasCommits && (
        <div className={styles.warning}>
          <p>⚠️ No commits selected. Select at least one commit to continue.</p>
        </div>
      )}
    </div>
  );
};
