import * as vscode from 'vscode';

import { IGitRef } from '../../common/git/types';

export type BranchItemAction = 'star' | 'delete' | 'rename' | 'push';

export type BranchActionButton = vscode.QuickInputButton & { action: BranchItemAction };

/**
 * Builds the inline QuickPick buttons for a single ref, based on its type:
 * - Tag: star + delete (tag).
 * - Remote branch: star + delete (remote branch).
 * - Local branch: star + delete + rename + push (push only when the branch
 *   has no upstream or is ahead of it). Buttons are shown for the current
 *   branch too — deleting it is blocked at action time with an explanatory
 *   message rather than by hiding the button.
 */
export function buildRefActionButtons(ref: IGitRef, isPreferred: boolean): BranchActionButton[] {
  const buttons: BranchActionButton[] = [
    {
      iconPath: new vscode.ThemeIcon(isPreferred ? 'star-full' : 'star'),
      tooltip: isPreferred ? 'Unstar' : 'Star',
      action: 'star',
    },
  ];

  if (ref.isTag) {
    buttons.push({ iconPath: new vscode.ThemeIcon('trash'), tooltip: 'Delete tag', action: 'delete' });
    return buttons;
  }

  if (ref.remote) {
    buttons.push({ iconPath: new vscode.ThemeIcon('trash'), tooltip: 'Delete remote branch', action: 'delete' });
    return buttons;
  }

  buttons.push({ iconPath: new vscode.ThemeIcon('trash'), tooltip: 'Delete branch', action: 'delete' });
  buttons.push({ iconPath: new vscode.ThemeIcon('edit'), tooltip: 'Rename branch', action: 'rename' });

  const canPush = !ref.upstreamTrack || Boolean(ref.parsedUpstreamTrack?.[0]);
  if (canPush) {
    buttons.push({ iconPath: new vscode.ThemeIcon('cloud-upload'), tooltip: 'Publish branch', action: 'push' });
  }

  return buttons;
}
