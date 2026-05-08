import * as vscode from 'vscode';

export const COPY_AND_OPEN_ISSUE_ACTION = 'Copy and open issue';
export const ISSUE_URL = 'https://github.com/zaknafeyn/git-smart-checkout/issues/new';

export async function showErrorMessageWithIssueAction(
  message: string,
  ...items: string[]
): Promise<string | undefined> {
  const actionItems = items.includes(COPY_AND_OPEN_ISSUE_ACTION)
    ? items
    : [...items, COPY_AND_OPEN_ISSUE_ACTION];
  const selectedAction = await vscode.window.showErrorMessage(message, ...actionItems);

  if (selectedAction !== COPY_AND_OPEN_ISSUE_ACTION) {
    return selectedAction;
  }

  try {
    await vscode.env.clipboard.writeText(message);
    await vscode.env.openExternal(vscode.Uri.parse(ISSUE_URL));
  } catch (error) {
    console.error('Failed to copy error message and open issue:', error);
  }

  return selectedAction;
}
