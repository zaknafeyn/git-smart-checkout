import * as vscode from 'vscode';
import { VscodeGitProvider } from '../common/git/vscodeGitProvider';
import { LoggingService } from '../logging/loggingService';
import { getGitExecutor } from '../utils/getGitExecutor';

export interface ICommand {
  execute(...args: any[]): Promise<void>;
  getPromptOptions?(): Promise<vscode.QuickPickItem[]>;
  validateInput?(input: string): string | undefined;
}

export abstract class BaseCommand implements ICommand {
  protected logService: LoggingService;
  constructor(logService: LoggingService) {
    this.logService = logService;
  }

  abstract execute(...args: any[]): Promise<void>;

  protected async showInputBox(options: vscode.InputBoxOptions): Promise<string | undefined> {
    return await vscode.window.showInputBox(options);
  }

  protected async getGitExecutor(vscodeGitProvider?: VscodeGitProvider) {
    return getGitExecutor(this.logService, vscodeGitProvider);
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
