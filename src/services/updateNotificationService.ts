import * as vscode from 'vscode';

export type WhatsNewMode = 'minor' | 'always' | 'never';

export class UpdateNotificationService {
  private shownThisSession = false;

  async checkOnActivation(context: vscode.ExtensionContext, mode: WhatsNewMode = 'minor'): Promise<void> {
    const current = String(context.extension.packageJSON.version ?? '0.0.0');
    const previous = context.globalState.get<string>('lastSeenVersion');
    await context.globalState.update('lastSeenVersion', current);
    if (!previous || mode === 'never' || this.shownThisSession || !this.shouldShow(previous, current, mode)) return;
    this.shownThisSession = true;
    const choice = await vscode.window.showInformationMessage(
      `Git Smart Checkout updated to v${current}`,
      "See what's new", 'Dismiss'
    );
    if (choice === "See what's new") {
      await vscode.env.openExternal(vscode.Uri.parse(`https://git-smart-checkout.vradchuk.info/#changelog-${current}`));
    }
  }

  private shouldShow(previous: string, current: string, mode: WhatsNewMode): boolean {
    if (mode === 'always') return previous !== current;
    const oldParts = previous.split('.').map(Number);
    const newParts = current.split('.').map(Number);
    return (newParts[0] ?? 0) > (oldParts[0] ?? 0) ||
      ((newParts[0] ?? 0) === (oldParts[0] ?? 0) && (newParts[1] ?? 0) > (oldParts[1] ?? 0));
  }
}
