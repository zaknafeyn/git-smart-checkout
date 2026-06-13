import * as vscode from 'vscode';

/**
 * Shows a buttonless notification toast that auto-dismisses after `durationMs`.
 *
 * VS Code's `showInformationMessage` has no controllable timeout, so we use the
 * progress notification location and resolve the underlying promise after a delay.
 */
export function showAutoDismissNotification(message: string, durationMs = 5000): void {
  void vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: message, cancellable: false },
    () => new Promise<void>((resolve) => setTimeout(resolve, durationMs))
  );
}
