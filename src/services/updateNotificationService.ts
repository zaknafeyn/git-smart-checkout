import * as vscode from 'vscode';

export type WhatsNewMode = 'minor' | 'always' | 'never';

export type FeedbackState = 'armed' | 'never' | `later:${number}`;

export const LAST_SEEN_VERSION_KEY = 'lastSeenVersion';
export const CHECKOUT_SUCCESS_COUNT_KEY = 'checkoutSuccessCount';
export const FEEDBACK_STATE_KEY = 'feedbackState';

const FEEDBACK_THRESHOLD = 30;
const FEEDBACK_RE_ARM_INTERVAL = 30;

const CHANGELOG_URL = (version: string) =>
  `https://github.com/zaknafeyn/git-smart-checkout/releases/tag/v${version}`;
const MARKETPLACE_REVIEW_URL =
  'https://marketplace.visualstudio.com/items?itemName=vradchuk.git-smart-checkout&ssr=false#review-details';

/**
 * Handles the two rate-limited, activation-triggered notifications:
 *  - "What's new" toast after a version bump (issue #69)
 *  - Feedback/rating ask after 30 successful stash-carrying checkouts (issue #26)
 *
 * At most one of these toasts is shown per activation/session; the what's-new
 * toast always wins and the feedback ask is deferred to the next activation.
 */
export class UpdateNotificationService {
  private shownThisSession = false;

  async checkOnActivation(context: vscode.ExtensionContext, mode: WhatsNewMode = 'minor'): Promise<void> {
    await this.checkWhatsNew(context, mode);
    await this.checkFeedback(context);
  }

  /** Called from the single success point of a stash-carrying checkout. */
  async recordStashCarryingCheckoutSuccess(context: vscode.ExtensionContext): Promise<void> {
    const count = context.globalState.get<number>(CHECKOUT_SUCCESS_COUNT_KEY, 0) + 1;
    await context.globalState.update(CHECKOUT_SUCCESS_COUNT_KEY, count);
  }

  private async checkWhatsNew(context: vscode.ExtensionContext, mode: WhatsNewMode): Promise<void> {
    const current = String(context.extension.packageJSON.version ?? '0.0.0');
    const previous = context.globalState.get<string>(LAST_SEEN_VERSION_KEY);
    await context.globalState.update(LAST_SEEN_VERSION_KEY, current);

    if (!previous || mode === 'never' || this.shownThisSession || !this.shouldShow(previous, current, mode)) {
      return;
    }

    this.shownThisSession = true;
    const choice = await vscode.window.showInformationMessage(
      `Git Smart Checkout updated to v${current}`,
      "See what's new",
      'Dismiss'
    );
    if (choice === "See what's new") {
      await vscode.env.openExternal(vscode.Uri.parse(CHANGELOG_URL(current)));
    }
  }

  private async checkFeedback(context: vscode.ExtensionContext): Promise<void> {
    // Mutual exclusion: never show the feedback ask in the same session as the what's-new toast.
    if (this.shownThisSession) {
      return;
    }

    const feedbackState = context.globalState.get<FeedbackState>(FEEDBACK_STATE_KEY, 'armed');
    if (feedbackState === 'never') {
      return;
    }

    const threshold = feedbackState === 'armed' ? FEEDBACK_THRESHOLD : Number(feedbackState.split(':')[1]);
    const count = context.globalState.get<number>(CHECKOUT_SUCCESS_COUNT_KEY, 0);
    if (count < threshold) {
      return;
    }

    this.shownThisSession = true;
    const choice = await vscode.window.showInformationMessage(
      'Enjoying Git Smart Checkout?',
      'Rate it',
      'Later',
      'Never'
    );

    if (choice === 'Rate it') {
      await vscode.env.openExternal(vscode.Uri.parse(MARKETPLACE_REVIEW_URL));
      await context.globalState.update(FEEDBACK_STATE_KEY, 'never' satisfies FeedbackState);
    } else if (choice === 'Never') {
      await context.globalState.update(FEEDBACK_STATE_KEY, 'never' satisfies FeedbackState);
    } else if (choice === 'Later') {
      await context.globalState.update(
        FEEDBACK_STATE_KEY,
        `later:${count + FEEDBACK_RE_ARM_INTERVAL}` satisfies FeedbackState
      );
    }
    // Dismissed without an explicit choice: leave state untouched, it will ask again next activation.
  }

  private shouldShow(previous: string, current: string, mode: WhatsNewMode): boolean {
    if (mode === 'always') return previous !== current;
    const oldParts = previous.split('.').map(Number);
    const newParts = current.split('.').map(Number);
    return (newParts[0] ?? 0) > (oldParts[0] ?? 0) ||
      ((newParts[0] ?? 0) === (oldParts[0] ?? 0) && (newParts[1] ?? 0) > (oldParts[1] ?? 0));
  }
}
