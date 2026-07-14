import * as assert from 'assert';
import * as vscode from 'vscode';

import { UserCancelledError } from '../../utils/userCancelledError';
import * as errorIssueNotification from '../../utils/errorIssueNotification';

/**
 * `clonePullRequest` in extension.ts is registered via a raw
 * `vscode.commands.registerCommand` (it needs webview wiring that doesn't fit
 * the `ICommand` interface), so it can't go through `CommandManager`. It
 * wraps its body in the same try/catch shape as `CommandManager.registerAll`
 * so errors (e.g. "Could not determine GitHub repository information") still
 * get the consistent error-notification treatment instead of vanishing as an
 * unhandled rejection. This test exercises that exact wrapping shape.
 */
function registerWithConsistentErrorHandling(
  commandId: string,
  callback: () => Promise<void>
): vscode.Disposable {
  return vscode.commands.registerCommand(commandId, async () => {
    try {
      await callback();
    } catch (error) {
      if (error instanceof UserCancelledError) {
        return;
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      await errorIssueNotification.showErrorMessageWithIssueAction(
        `Command failed: ${errorMessage}`,
        'OK'
      );
    }
  });
}

describe('clonePullRequest-style raw command error handling', () => {
  it('shows the consistent error notification when repository info cannot be determined', async () => {
    const commandId = 'gitSmartCheckout.test.clonePullRequestFailure';
    const disposable = registerWithConsistentErrorHandling(commandId, async () => {
      throw new Error('Could not determine GitHub repository information');
    });

    const originalShow = errorIssueNotification.showErrorMessageWithIssueAction;
    let notificationMessage: string | undefined;
    (
      errorIssueNotification as unknown as { showErrorMessageWithIssueAction: typeof originalShow }
    ).showErrorMessageWithIssueAction = async (message: string) => {
      notificationMessage = message;
      return undefined;
    };

    try {
      await vscode.commands.executeCommand(commandId);
      assert.strictEqual(
        notificationMessage,
        'Command failed: Could not determine GitHub repository information'
      );
    } finally {
      (
        errorIssueNotification as unknown as {
          showErrorMessageWithIssueAction: typeof originalShow;
        }
      ).showErrorMessageWithIssueAction = originalShow;
      disposable.dispose();
    }
  });

  it('silently swallows UserCancelledError without a notification', async () => {
    const commandId = 'gitSmartCheckout.test.clonePullRequestCancelled';
    const disposable = registerWithConsistentErrorHandling(commandId, async () => {
      throw new UserCancelledError();
    });

    const originalShow = errorIssueNotification.showErrorMessageWithIssueAction;
    let notificationShown = false;
    (
      errorIssueNotification as unknown as { showErrorMessageWithIssueAction: typeof originalShow }
    ).showErrorMessageWithIssueAction = async () => {
      notificationShown = true;
      return undefined;
    };

    try {
      await vscode.commands.executeCommand(commandId);
      assert.strictEqual(notificationShown, false);
    } finally {
      (
        errorIssueNotification as unknown as {
          showErrorMessageWithIssueAction: typeof originalShow;
        }
      ).showErrorMessageWithIssueAction = originalShow;
      disposable.dispose();
    }
  });
});
