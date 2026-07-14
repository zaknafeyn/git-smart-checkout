import * as vscode from 'vscode';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { resolveBranchTemplate } from '../../services/branchTemplateService';
import { LoggingService } from '../../logging/loggingService';
import { BaseCommand } from '../command';

export class PreviewTemplateCommand extends BaseCommand {
  constructor(private readonly config: ConfigurationManager, logService: LoggingService) { super(logService); }

  async execute(): Promise<void> {
    const git = await this.getGitExecutor();
    const cfg = this.config.get();
    const template = cfg.branchTemplate || cfg.tagTemplate;
    if (!template) {
      await vscode.window.showInformationMessage('Configure a branchTemplate or tagTemplate before previewing.', 'OK');
      return;
    }
    const resolved = await resolveBranchTemplate(template, {
      workspaceRoot: git.repositoryPath,
      getCurrentBranch: () => git.getCurrentBranch(),
      branchExists: (name) => git.branchExist(name),
      logger: {
        info: (message, data) => this.logService.info(message, data),
        warn: (message, data) => this.logService.warn(message, data),
        debug: (message, data) => this.logService.debug(message, data),
      },
    });
    const content = `Template : ${template}\nResult   : ${resolved.branch}\n\nToken resolution:\n  Production resolver completed successfully.`;
    const document = await vscode.workspace.openTextDocument({ content, language: 'gsc-template-preview' });
    await vscode.window.showTextDocument(document, { preview: false });
    const action = await vscode.window.showInformationMessage('Template preview ready.', 'Copy result');
    if (action === 'Copy result') await vscode.env.clipboard.writeText(resolved.branch);
  }
}
