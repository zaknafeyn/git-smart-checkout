import { LoggingService } from '../../logging/loggingService';
import { StatusBarManager } from '../../statusBar/statusBarManager';
import { BaseCommand } from '../command';

export class SwitchModeCommand extends BaseCommand {
  private statusBarManager: StatusBarManager;

  constructor(statusBarManager: StatusBarManager, logService: LoggingService) {
    super(logService);

    this.statusBarManager = statusBarManager;
  }

  async execute(): Promise<void> {
    await this.statusBarManager.showModeQuickPick();
  }
}
