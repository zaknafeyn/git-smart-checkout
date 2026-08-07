import * as vscode from 'vscode';

import { AnalyticsEvent, capture, captureException } from '../../analytics/analytics';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { LoggingService } from '../../logging/loggingService';
import {
  branchTemplateNeedsJira,
  resolveBranchTemplate,
  resolveBranchTemplateWithTrace,
  ScriptTokenError,
} from '../../services/branchTemplateService';
import { JiraIssueFilterStore } from '../../services/jiraIssueFilterStore';
import {
  createJiraClient,
  fetchJiraIssueByKey,
  isJiraConfigured,
  pickJiraIssue,
} from '../../services/jiraService';
import { getBranchTemplates } from '../../services/templateList';
import { BaseCommand } from '../command';
import { pickTemplate } from '../utils/pickTemplate';
import { validateBranchName } from './validateBranchName';

const COPY_BRANCH_ACTION = 'Copy Branch Name';

export class CreateBranchFromTemplateCommand extends BaseCommand {
  constructor(
    private readonly configManager: ConfigurationManager,
    logService: LoggingService,
    private readonly jiraIssueFilterStore?: JiraIssueFilterStore
  ) {
    super(logService);
  }

  async execute(): Promise<void> {
    const log = (msg: string, data?: unknown) =>
      this.logService.info(`[Create Branch] ${msg}`, data);

    log('Started');

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      await this.showErrorMessage('No workspace folder is open.');
      return;
    }

    let git: Awaited<ReturnType<typeof this.getGitExecutor>>;
    try {
      git = await this.getGitExecutor();
    } catch (e) {
      this.logService.error('[Create Branch] Could not initialize Git executor', e);
      await this.showErrorMessage('Current workspace is not a Git repository.');
      return;
    }
    const workspaceRoot = git.repositoryPath;

    const cfg = this.configManager.get();
    const templates = getBranchTemplates(cfg);

    if (templates.length === 0) {
      await this.showErrorMessage(
        'No branch template is configured. Set git-smart-checkout.branchTemplates in settings.'
      );
      return;
    }

    const previewLogger = {
      info: (m: string, d?: unknown) => this.logService.info(m, d),
      warn: (m: string, d?: unknown) => this.logService.warn(m, d),
      debug: (m: string, d?: unknown) => this.logService.debug(m, d),
    };
    const getCurrentBranch = async (): Promise<string> => {
      try {
        const branch = await git.getCurrentBranch();
        return branch ?? '';
      } catch {
        return '';
      }
    };

    const selected = await pickTemplate(
      templates,
      async (entry) => {
        const traced = await resolveBranchTemplateWithTrace(
          entry.template,
          {
            workspaceRoot,
            getCurrentBranch,
            branchExists: (name) => git.branchExist(name),
            logger: previewLogger,
          },
          { preview: true }
        );
        return traced.branch;
      },
      'Select a branch template'
    );
    if (!selected) {
      return;
    }
    const template = selected.template;

    let jiraKey: string | undefined;
    let jiraTitle: string | undefined;

    if (branchTemplateNeedsJira(template)) {
      if (!isJiraConfigured(cfg.jira)) {
        await this.showErrorMessage(
          'Branch template requires Jira. Set git-smart-checkout.jira.domain and jira.username, then run "GSC: Set Jira Token...".'
        );
        return;
      }

      const issue = await pickJiraIssue(cfg.jira, this.logService, this.jiraIssueFilterStore);
      if (!issue) {
        return;
      }

      jiraKey = issue.key.toUpperCase();
      jiraTitle = issue.summary;

      if (!jiraTitle) {
        const client = createJiraClient(cfg.jira, this.logService);
        if (client) {
          const fetched = await fetchJiraIssueByKey(client, jiraKey);
          jiraTitle = fetched?.summary ?? '';
        }
      }
    }

    log(`Template: ${template}`);

    let resolved: Awaited<ReturnType<typeof resolveBranchTemplate>>;
    try {
      resolved = await resolveBranchTemplate(template, {
        workspaceRoot,
        jiraKey,
        jiraTitle,
        getCurrentBranch,
        branchExists: (name) => git.branchExist(name),
        logger: previewLogger,
      });
    } catch (e) {
      if (e instanceof ScriptTokenError) {
        const detail = e.exitCode !== undefined ? ` (exit code ${e.exitCode})` : '';
        await this.showErrorMessage(
          `Script "${e.scriptPath}" failed${detail}. Branch creation stopped.`
        );
      } else {
        this.logService.error('[Create Branch] Template resolution failed', e);
        await this.showErrorMessage(
          'Failed to resolve branch template. Check the output channel for details.'
        );
      }
      return;
    }

    let branchName = resolved.branch;
    const hadRecurringToken = resolved.hadRecurringToken;

    if (!branchName) {
      await this.showErrorMessage(
        'Generated branch name is empty. Please check the branch template.'
      );
      return;
    }

    const validationError = validateBranchName(branchName);
    if (validationError) {
      await this.showErrorMessage(`Invalid branch name "${branchName}": ${validationError}`);
      return;
    }

    if (!hadRecurringToken) {
      const exists = await git.branchExist(branchName);
      if (exists) {
        await this.showErrorMessage(`Branch "${branchName}" already exists.`);
        return;
      }
    }

    const confirmedName = await this.promptEditableBranchName(
      branchName,
      git,
      hadRecurringToken
    );
    if (!confirmedName) {
      return;
    }
    branchName = confirmedName;

    try {
      await git.createBranch(branchName);
      log(`Branch created and checked out: ${branchName}`);
      const jiraFilter = jiraKey ? this.jiraIssueFilterStore?.get() : undefined;
      capture(AnalyticsEvent.BranchFromTemplateCreated, {
        used_jira: Boolean(jiraKey),
        had_recurring_token: hadRecurringToken,
        jira_assignee_filter: jiraFilter?.assignee,
        jira_status_filter: jiraFilter?.status,
        jira_project_filtered: jiraFilter ? jiraFilter.projectKeys.length > 0 : undefined,
        jira_custom_jql: jiraKey ? cfg.jira.customJql.trim() !== '' : undefined,
      });
    } catch (e) {
      captureException(e);
      this.logService.error('[Create Branch] Branch creation failed', e);
      await this.showErrorMessage(`Failed to create branch "${branchName}".`);
      return;
    }

    const action = await this.showInformationMessage(
      `Branch "${branchName}" created and checked out.`,
      COPY_BRANCH_ACTION
    );
    if (action === COPY_BRANCH_ACTION) {
      try {
        await vscode.env.clipboard.writeText(branchName);
        await this.showInformationMessage(`Copied branch name "${branchName}" to clipboard.`);
      } catch (e) {
        captureException(e);
        await this.showErrorMessage(`Failed to copy branch name to clipboard.`);
      }
    }
  }

  private async promptEditableBranchName(
    initialName: string,
    git: Awaited<ReturnType<typeof this.getGitExecutor>>,
    skipExistenceOnInitial: boolean
  ): Promise<string | undefined> {
    return this.showInputBox({
      title: 'Create branch',
      prompt: 'Edit the branch name if needed, then press Enter to create',
      value: initialName,
      ignoreFocusOut: true,
      validateInput: async (value) => {
        const err = validateBranchName(value);
        if (err) {
          return err;
        }
        if (value === initialName && skipExistenceOnInitial) {
          return undefined;
        }
        if (await git.branchExist(value)) {
          return `Branch "${value}" already exists`;
        }
        return undefined;
      },
    });
  }
}
