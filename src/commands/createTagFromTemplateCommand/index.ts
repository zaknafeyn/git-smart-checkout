import * as vscode from 'vscode';

import { BaseCommand } from '../command';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { LoggingService } from '../../logging/loggingService';
import {
  resolveTagTemplate,
  ScriptTokenError,
  TagTemplateContext,
} from '../../services/tagTemplateService';
import { validateTagName } from './validateTagName';
import { AnalyticsEvent, capture, captureException } from '../../analytics/analytics';

export class CreateTagFromTemplateCommand extends BaseCommand {
  constructor(
    private readonly configManager: ConfigurationManager,
    logService: LoggingService
  ) {
    super(logService);
  }

  async execute(): Promise<void> {
    const log = (msg: string, data?: unknown) =>
      this.logService.info(`[Create Tag] ${msg}`, data);

    log('Started');

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      await this.showErrorMessage('No workspace folder is open.');
      return;
    }
    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    log(`Current workspace folder: ${workspaceRoot}`);

    let git: Awaited<ReturnType<typeof this.getGitExecutor>>;
    try {
      git = await this.getGitExecutor();
    } catch (e) {
      this.logService.error('[Create Tag] Could not initialize Git executor', e);
      await this.showErrorMessage('Current workspace is not a Git repository.');
      return;
    }

    const cfg = this.configManager.get();
    const template = (cfg.tagTemplate ?? '').trim();
    const remote = cfg.tagRemote || 'origin';

    let tagName: string;
    let hadRecurringToken = false;

    if (template === '') {
      const input = await this.promptManualTagName(git);
      if (!input) {
        return;
      }
      tagName = input;
    } else {
      log(`Template: ${template}`);
      const ctx: TagTemplateContext = {
        workspaceRoot,
        getCurrentBranch: async () => {
          try {
            const branch = await git.getCurrentBranch();
            return branch ?? '';
          } catch {
            return '';
          }
        },
        tagExists: (name) => git.tagExists(name),
        logger: {
          info: (m, d) => this.logService.info(m, d),
          warn: (m, d) => this.logService.warn(m, d),
          debug: (m, d) => this.logService.debug(m, d),
        },
      };

      let resolved: Awaited<ReturnType<typeof resolveTagTemplate>>;
      try {
        resolved = await resolveTagTemplate(template, ctx);
      } catch (e) {
        if (e instanceof ScriptTokenError) {
          this.logService.error('[Create Tag] Script execution failed', e);
          const detail = e.exitCode !== undefined ? ` (exit code ${e.exitCode})` : '';
          await this.showErrorMessage(
            `Script "${e.scriptPath}" failed${detail}. Tag creation stopped.`
          );
        } else {
          this.logService.error('[Create Tag] Template resolution failed', e);
          await this.showErrorMessage(
            'Failed to resolve tag template. Check the output channel for details.'
          );
        }
        return;
      }

      tagName = resolved.tag;
      hadRecurringToken = resolved.recurringValueUsed !== undefined;
      log(`Final tag: ${tagName}`);
    }

    if (!tagName) {
      await this.showErrorMessage(
        'Generated tag is empty. Please check the tag template.'
      );
      return;
    }

    const validationError = validateTagName(tagName);
    if (validationError) {
      await this.showErrorMessage(`Invalid tag name "${tagName}": ${validationError}`);
      return;
    }

    // If no {r:...} token, verify the tag doesn't already exist
    if (!hadRecurringToken) {
      const exists = await git.tagExists(tagName);
      if (exists) {
        await this.showErrorMessage(`Tag "${tagName}" already exists.`);
        return;
      }
    }

    const confirm = await vscode.window.showInformationMessage(
      `Create Git tag "${tagName}"?`,
      { modal: true },
      'Create'
    );
    if (confirm !== 'Create') {
      return;
    }

    try {
      await git.createTag(tagName);
      log('Tag created successfully');
      capture(AnalyticsEvent.TagCreated, { used_template: template !== '' });
    } catch (e) {
      captureException(e);
      this.logService.error('[Create Tag] Tag creation failed', e);
      await this.showErrorMessage(`Failed to create tag "${tagName}".`);
      return;
    }

    await this.handlePush(tagName, remote, cfg.pushTagWithoutConfirmation);
  }

  private async promptManualTagName(
    git: Awaited<ReturnType<typeof this.getGitExecutor>>
  ): Promise<string | undefined> {
    const input = await this.showInputBox({
      prompt: 'Enter Git tag name',
      placeHolder: 'e.g. v1.2.3',
      validateInput: async (value) => {
        const err = validateTagName(value);
        if (err) {
          return err;
        }
        if (await git.tagExists(value)) {
          return `Tag "${value}" already exists`;
        }
        return undefined;
      },
    });

    return input;
  }

  private async handlePush(
    tagName: string,
    remote: string,
    autoPush: boolean
  ): Promise<void> {
    const git = await this.getGitExecutor();
    let shouldPush = autoPush;

    if (!autoPush) {
      const ans = await this.showInformationMessage(
        `Push tag "${tagName}" to "${remote}"?`,
        'Push',
        'Skip'
      );
      shouldPush = ans === 'Push';
    }

    if (!shouldPush) {
      await this.showInformationMessage(`Tag "${tagName}" created.`);
      return;
    }

    try {
      await git.pushTag(tagName, remote);
      this.logService.info('[Create Tag] Tag pushed successfully to ' + remote);
      capture(AnalyticsEvent.TagPushed);
      await this.showInformationMessage(
        `Tag "${tagName}" created and pushed to ${remote}.`
      );
    } catch (e) {
      captureException(e);
      this.logService.error('[Create Tag] Push failed', e);
      await this.showWarningMessage(
        `Tag "${tagName}" was created locally, but push failed.`
      );
    }
  }
}
