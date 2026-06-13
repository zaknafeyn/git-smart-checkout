import { AnalyticsEvent, capture, captureException } from '../../analytics/analytics';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { LoggingService } from '../../logging/loggingService';
import { BaseCommand } from '../command';

/**
 * Guided Jira setup: collects the domain, username, and API token through three
 * input boxes. Domain and username are stored in settings (and remain editable
 * there); the API token is stored in VS Code Secret Storage.
 */
export class InitJiraCommand extends BaseCommand {
  constructor(
    private readonly configManager: ConfigurationManager,
    logService: LoggingService
  ) {
    super(logService);
  }

  async execute(): Promise<void> {
    const jira = this.configManager.get().jira;

    const domain = await this.showInputBox({
      title: 'Init Jira (1 of 3): Domain',
      prompt: 'Jira Cloud host, e.g. your-company.atlassian.net',
      placeHolder: 'your-company.atlassian.net',
      value: jira.domain,
      ignoreFocusOut: true,
    });
    if (domain === undefined) {
      return;
    }

    const username = await this.showInputBox({
      title: 'Init Jira (2 of 3): Username',
      prompt: 'Atlassian account username (usually your account email)',
      placeHolder: 'you@example.com',
      value: jira.username,
      ignoreFocusOut: true,
    });
    if (username === undefined) {
      return;
    }

    const token = await this.showInputBox({
      title: 'Init Jira (3 of 3): API token',
      prompt: jira.token
        ? 'API token (hidden). Leave unchanged to keep it, clear it to remove, or type a new token.'
        : 'API token, stored securely in VS Code Secret Storage.',
      placeHolder: 'Paste your Atlassian API token',
      value: jira.token,
      password: true,
      ignoreFocusOut: true,
    });
    if (token === undefined) {
      return;
    }

    try {
      await this.configManager.updateJiraDomain(domain.trim());
      await this.configManager.updateJiraUsername(username.trim());
      await this.configManager.setJiraToken(token);
    } catch (e) {
      captureException(e);
      this.logService.error('[Jira] Failed to save Jira credentials', e);
      await this.showErrorMessage(
        'Failed to save Jira credentials. See the output channel for details.'
      );
      return;
    }

    capture(AnalyticsEvent.JiraInitialized, {
      has_domain: domain.trim() !== '',
      has_username: username.trim() !== '',
      has_token: token.trim() !== '',
    });

    this.logService.info(
      '[Jira] Credentials saved (domain and username in settings, token in Secret Storage)'
    );
    await this.showInformationMessage('Jira credentials saved.');
  }
}
