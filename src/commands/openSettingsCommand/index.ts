import { commands } from 'vscode';

import { AnalyticsEvent, capture } from '../../analytics/analytics';
import { EXTENSION_ID } from '../../const';
import { LoggingService } from '../../logging/loggingService';
import { BaseCommand } from '../command';

export class OpenSettingsCommand extends BaseCommand {
  constructor(logService: LoggingService) {
    super(logService);
  }

  async execute(): Promise<void> {
    capture(AnalyticsEvent.SettingsOpened);

    await commands.executeCommand('workbench.action.openSettings', `@ext:${EXTENSION_ID}`);
  }
}
