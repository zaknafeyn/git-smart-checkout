import * as vscode from 'vscode';

export interface ICommand {
  execute(...args: any[]): Promise<void>;
  getPromptOptions?(): Promise<vscode.QuickPickItem[]>;
  validateInput?(input: string): string | undefined;
}

export abstract class BaseCommand implements ICommand {
  abstract execute(...args: any[]): Promise<void>;

  protected async showInputBox(options: vscode.InputBoxOptions): Promise<string | undefined> {
    return await vscode.window.showInputBox(options);
  }

  protected async showQuickPick(
    items: vscode.QuickPickItem[],
    options?: vscode.QuickPickOptions
  ): Promise<vscode.QuickPickItem | undefined> {
    return await vscode.window.showQuickPick(items, options);
  }

  protected async showInformationMessage(
    message: string,
    ...items: string[]
  ): Promise<string | undefined> {
    return await vscode.window.showInformationMessage(message, ...items);
  }

  protected async showWarningMessage(
    message: string,
    ...items: string[]
  ): Promise<string | undefined> {
    return await vscode.window.showWarningMessage(message, ...items);
  }

  protected async showErrorMessage(
    message: string,
    ...items: string[]
  ): Promise<string | undefined> {
    return await vscode.window.showErrorMessage(message, ...items);
  }
}
