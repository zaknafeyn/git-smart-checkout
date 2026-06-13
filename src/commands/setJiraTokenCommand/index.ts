import { AnalyticsEvent, capture, captureException } from '../../analytics/analytics';
import { ConfigurationManager } from '../../configuration/configurationManager';
import { LoggingService } from '../../logging/loggingService';
import { BaseCommand } from '../command';

export class SetJiraTokenCommand extends BaseCommand {
  constructor(
    private readonly configManager: ConfigurationManager,
    logService: LoggingService
  ) {
    super(logService);
  }

  async execute(): Promise<void> {
    const hasToken = this.configManager.hasJiraToken();

    const input = await this.showInputBox({
      title: 'Set Jira API token',
      prompt: hasToken
        ? 'Enter a new Jira API token, or leave empty to remove the stored token.'
        : 'Enter your Jira API token. It is stored securely in VS Code Secret Storage.',
      placeHolder: hasToken
        ? 'A token is already stored — typing replaces it'
        : 'Paste your Atlassian API token',
      password: true,
      ignoreFocusOut: true,
    });

    if (input === undefined) {
      // The user dismissed the input box.
      return;
    }

    const token = input.trim();

    try {
      await this.configManager.setJiraToken(token);
    } catch (e) {
      captureException(e);
      this.logService.error('[Jira] Failed to update the Jira token in Secret Storage', e);
      await this.showErrorMessage(
        'Failed to update the Jira API token. See the output channel for details.'
      );
      return;
    }

    capture(AnalyticsEvent.JiraTokenSet, { cleared: token === '' });

    if (token === '') {
      this.logService.info('[Jira] Token removed from Secret Storage');
      await this.showInformationMessage('Jira API token removed from Secret Storage.');
    } else {
      this.logService.info('[Jira] Token saved to Secret Storage');
      await this.showInformationMessage('Jira API token saved to Secret Storage.');
    }
  }
}
