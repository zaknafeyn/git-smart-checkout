import { QuickPickItem, QuickPickOptions, window } from "vscode";

export async function showQuickPick(
    items: QuickPickItem[],
    options?: QuickPickOptions
  ): Promise<QuickPickItem | undefined> {
    return await window.showQuickPick(items, options) as QuickPickItem | undefined;
  }
