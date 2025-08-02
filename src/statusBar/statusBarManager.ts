import {
  commands,
  Disposable,
  QuickPickItem,
  StatusBarAlignment,
  StatusBarItem,
  ThemeColor,
  window,
} from 'vscode';
import { ConfigurationManager } from '../configuration/configurationManager';
import { LoggingService } from '../logging/loggingService';
import { EXTENSION_NAME } from '../const';
import {
  AUTO_STASH_MODE_MANUAL,
  AUTO_STASH_MODES,
  AUTO_STASH_MODES_DETAILS,
  TAutoStashModeConfig,
} from '../configuration/extensionConfig';

export class StatusBarManager implements Disposable {
  private statusBarItem: StatusBarItem;
  private configManager: ConfigurationManager;
  private loggingService: LoggingService;

  constructor(configManager: ConfigurationManager, loggingService: LoggingService) {
    this.configManager = configManager;
    this.loggingService = loggingService;

    this.statusBarItem = window.createStatusBarItem(StatusBarAlignment.Right, 100);

    this.statusBarItem.command = `${EXTENSION_NAME}.switchMode`;
    this.updateStatusBar();
  }

  private updateStatusBar(): void {
    const config = this.configManager.get();

    const modeDetails = AUTO_STASH_MODES_DETAILS[config.mode as TAutoStashModeConfig];

    this.statusBarItem.text = `${modeDetails.icon} ${modeDetails.briefLabel}`;
    this.statusBarItem.tooltip = `${EXTENSION_NAME}\nCurrent mode: ${modeDetails.label}\nClick to switch modes`;

    const statusBarColor =
      config.mode === AUTO_STASH_MODE_MANUAL
        ? 'statusBarItem.descriptionForeground'
        : 'statusBarItem.warningBackground';

    this.statusBarItem.backgroundColor = new ThemeColor(statusBarColor);

    // Show or hide based on configuration
    if (config.showStatusBar) {
      this.statusBarItem.show();
    } else {
      this.statusBarItem.hide();
    }
  }

  public async showModeQuickPick(): Promise<void> {
    const config = this.configManager.get();
    const currentMode = config.mode;

    const items: QuickPickItem[] = AUTO_STASH_MODES.map((mode) => {
      const modeDetails = AUTO_STASH_MODES_DETAILS[mode];
      return {
        label: `${modeDetails.icon} ${modeDetails.label}`,
        description: modeDetails.description,
        detail: currentMode === mode ? 'Currently active' : undefined,
      } as QuickPickItem;
    });

    const selection = await window.showQuickPick(items, {
      title: 'Select Auto Stash Checkout  Mode',
      placeHolder: 'Choose the operating mode for your extension',
    });

    if (!selection) {
      return;
    }

    this.loggingService.info(`Auto Stash Checkout  Mode: ${selection?.label}`);

    const [_, ...rest] = selection.label.split(' ');
    const newModeLabel = rest.join(' ');
    const newMode = AUTO_STASH_MODES.find(
      (mode) => AUTO_STASH_MODES_DETAILS[mode].label === newModeLabel
    );

    this.loggingService.info(`New mode: ${newMode}, newModeLabel: ${newModeLabel}`);

    if (newMode && newMode !== currentMode) {
      const modeDetails = AUTO_STASH_MODES_DETAILS[newMode];
      await this.configManager.updateMode(newMode);
      this.updateStatusBar();
      this.loggingService.info(`Mode switched to: ${newMode}`);

      window
        .showInformationMessage(`Extension mode changed to: ${modeDetails.label}`, 'Open Settings')
        .then((selection) => {
          if (selection === 'Open Settings') {
            commands.executeCommand(`${EXTENSION_NAME}.openSettings`);
          }
        });
    }
  }

  public show(): void {
    const config = this.configManager.get();
    if (config.showStatusBar) {
      this.statusBarItem.show();
    }
  }

  public hide(): void {
    this.statusBarItem.hide();
  }

  public onConfigurationChanged(): void {
    this.updateStatusBar();
  }

  public dispose(): void {
    this.statusBarItem.dispose();
  }
}
