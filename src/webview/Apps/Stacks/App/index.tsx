import React, { useEffect, useState } from 'react';

import { Button } from '@/components/Button';
import { StackList } from '@/components/StackList';
import { useLogger } from '@/hooks';
import { useSendMessage } from '@/hooks/useSendMessage';
import { WebviewCommand } from '@/types/commands';

import { StackView } from '../../../../services/stackModel';

import styles from './module.css';

interface StacksAppState {
  view?: StackView;
}

export const StacksApp: React.FC = () => {
  const logger = useLogger(false);
  const sendMessage = useSendMessage();

  const [state, setState] = useState<StacksAppState>({});
  const [isFetchingTarget, setIsFetchingTarget] = useState(false);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      logger.debug(`[StacksApp] Received message: ${message.command}`);

      if (message.command === WebviewCommand.UPDATE_STACK) {
        setState({ view: message.view ?? undefined });
        // A fetch always ends in a refresh, so a fresh UPDATE_STACK is the
        // signal the in-flight fetch (if any) has completed.
        setIsFetchingTarget(false);
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('message', handleMessage);
      sendMessage(WebviewCommand.WEBVIEW_READY);
      return () => window.removeEventListener('message', handleMessage);
    }
  }, [logger, sendMessage]);

  const handleCheckout = (branch: string) => {
    logger.info(`Checking out stack branch: ${branch}`);
    sendMessage(WebviewCommand.STACK_CHECKOUT_BRANCH, { branch });
  };

  const handleOpenPr = (prNumber: number) => {
    logger.info(`Opening PR #${prNumber}`);
    sendMessage(WebviewCommand.STACK_OPEN_PR, { prNumber });
  };

  const handleCopyBranchName = (branch: string) => {
    void navigator.clipboard?.writeText(branch);
    logger.info(`Copied branch name: ${branch}`);
  };

  const handleRefresh = () => {
    logger.info('Refreshing stacks');
    sendMessage(WebviewCommand.STACK_REFRESH);
  };

  const handleFetchTarget = () => {
    logger.info('Fetching latest changes for the stack target branch');
    setIsFetchingTarget(true);
    sendMessage(WebviewCommand.STACK_FETCH_TARGET);
  };

  const { view } = state;

  return (
    <div className={styles.container}>
      {view ? (
        <StackList
          view={view}
          onCheckout={handleCheckout}
          onOpenPr={handleOpenPr}
          onCopyBranchName={handleCopyBranchName}
          onFetchTarget={handleFetchTarget}
          isFetchingTarget={isFetchingTarget}
        />
      ) : (
        <div className={styles.emptyState}>
          <p>Current branch is not part of a stack.</p>
          <Button variant="secondary" onClick={handleRefresh}>
            Refresh
          </Button>
        </div>
      )}
    </div>
  );
};
