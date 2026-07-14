import * as assert from 'assert';
import * as vscode from 'vscode';

import { CommandManager } from '../../commands/commandManager';
import { ICommand } from '../../commands/command';
import { UserCancelledError } from '../../utils/userCancelledError';
import * as errorIssueNotification from '../../utils/errorIssueNotification';

describe('CommandManager user-cancellation handling', () => {
  it('swallows UserCancelledError silently, without an error notification', async () => {
    const manager = new CommandManager();
    const commandId = 'gitSmartCheckout.test.userCancelledCommand';

    const command: ICommand = {
      execute: async () => {
        throw new UserCancelledError();
      },
    };
    manager.registerCommand(commandId, command);

    const originalShow = errorIssueNotification.showErrorMessageWithIssueAction;
    let notificationShown = false;
    (
      errorIssueNotification as unknown as {
        showErrorMessageWithIssueAction: typeof originalShow;
      }
    ).showErrorMessageWithIssueAction = async (message: string, ...items: string[]) => {
      notificationShown = true;
      return undefined;
    };

    const context = { subscriptions: [] } as unknown as vscode.ExtensionContext;

    try {
      manager.registerAll(context);
      await vscode.commands.executeCommand(commandId);

      assert.strictEqual(notificationShown, false, 'should not show an error notification');
    } finally {
      (
        errorIssueNotification as unknown as {
          showErrorMessageWithIssueAction: typeof originalShow;
        }
      ).showErrorMessageWithIssueAction = originalShow;
      manager.dispose();
    }
  });

  it('still shows an error notification for a genuine failure', async () => {
    const manager = new CommandManager();
    const commandId = 'gitSmartCheckout.test.genuineFailureCommand';

    const command: ICommand = {
      execute: async () => {
        throw new Error('boom');
      },
    };
    manager.registerCommand(commandId, command);

    const originalShow = errorIssueNotification.showErrorMessageWithIssueAction;
    let notificationMessage: string | undefined;
    (
      errorIssueNotification as unknown as {
        showErrorMessageWithIssueAction: typeof originalShow;
      }
    ).showErrorMessageWithIssueAction = async (message: string, ...items: string[]) => {
      notificationMessage = message;
      return undefined;
    };

    const context = { subscriptions: [] } as unknown as vscode.ExtensionContext;

    try {
      manager.registerAll(context);
      await vscode.commands.executeCommand(commandId);

      assert.strictEqual(notificationMessage, 'Command failed: boom');
    } finally {
      (
        errorIssueNotification as unknown as {
          showErrorMessageWithIssueAction: typeof originalShow;
        }
      ).showErrorMessageWithIssueAction = originalShow;
      manager.dispose();
    }
  });
});
