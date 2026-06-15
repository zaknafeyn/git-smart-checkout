import {
  commands,
  Disposable,
  QuickPickItem,
  QuickPickItemKind,
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
import { AnalyticsEvent, capture } from '../analytics/analytics';

interface QuickActionItem extends QuickPickItem {
  commandId?: string;
}

export function getStatusBarBackgroundColor(
  mode: TAutoStashModeConfig
): ThemeColor | undefined {
  return mode === AUTO_STASH_MODE_MANUAL
    ? undefined
    : new ThemeColor('statusBarItem.warningBackground');
}

export class StatusBarManager implements Disposable {
  private statusBarItem: StatusBarItem;
  private configManager: ConfigurationManager;
  private loggingService: LoggingService;

  constructor(configManager: ConfigurationManager, loggingService: LoggingService) {
    this.configManager = configManager;
    this.loggingService = loggingService;

    this.statusBarItem = window.createStatusBarItem(StatusBarAlignment.Right, 100);

    this.statusBarItem.command = `${EXTENSION_NAME}.showStatusBarMenu`;
    this.updateStatusBar();
  }

  private updateStatusBar(): void {
    const config = this.configManager.get();

    const modeDetails = AUTO_STASH_MODES_DETAILS[config.mode as TAutoStashModeConfig];

    this.statusBarItem.text = `${modeDetails.icon} ${modeDetails.briefLabel}`;
    this.statusBarItem.tooltip = `${EXTENSION_NAME}\nCurrent mode: ${modeDetails.label}\nClick to open quick actions`;

    this.statusBarItem.backgroundColor = getStatusBarBackgroundColor(config.mode);

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
      title: 'Select Auto Stash Checkout Mode',
      placeHolder: 'Choose the operating mode for your extension',
    });

    if (!selection) {
      return;
    }

    this.loggingService.info(`Auto Stash Checkout Mode: ${selection?.label}`);

    const [_, ...rest] = selection.label.split(' ');
    const newModeLabel = rest.join(' ');
    const newMode = AUTO_STASH_MODES.find(
      (mode) => AUTO_STASH_MODES_DETAILS[mode].label === newModeLabel
    );

    this.loggingService.info(`New mode: ${newMode}, newModeLabel: ${newModeLabel}`);

    if (newMode && newMode !== currentMode) {
      // const modeDetails = AUTO_STASH_MODES_DETAILS[newMode];
      await this.configManager.updateMode(newMode);
      this.updateStatusBar();
      this.loggingService.info(`Mode switched to: ${newMode}`);
      capture(AnalyticsEvent.StashModeSwitched, { from_mode: currentMode, to_mode: newMode });

      // window
      //   .showInformationMessage(`Extension mode changed to: ${modeDetails.label}`, 'Open Settings')
      //   .then((selection) => {
      //     if (selection === 'Open Settings') {
      //       commands.executeCommand(`${EXTENSION_NAME}.openSettings`);
      //     }
      //   });
    }
  }

  public async showQuickActionsMenu(): Promise<void> {
    capture(AnalyticsEvent.StatusBarMenuOpened);

    const config = this.configManager.get();
    const modeDetails = AUTO_STASH_MODES_DETAILS[config.mode as TAutoStashModeConfig];
    const command = (name: string) => `${EXTENSION_NAME}.${name}`;

    const items: QuickActionItem[] = [
      { label: 'Stash mode', kind: QuickPickItemKind.Separator },
      {
        label: '$(gear) Switch stash mode',
        description: `Current: ${modeDetails.briefLabel}`,
        commandId: command('switchMode'),
      },
      { label: 'Checkout', kind: QuickPickItemKind.Separator },
      { label: '$(arrow-swap) Checkout to…', commandId: command('checkoutTo') },
      { label: '$(history) Checkout previous branch', commandId: command('checkoutPrevious') },
      { label: '$(git-pull-request) Checkout by PR number…', commandId: command('checkoutByPR') },
      { label: 'Update branch', kind: QuickPickItemKind.Separator },
      { label: '$(repo-pull) Pull (With Stash)', commandId: command('pullWithStash') },
      { label: '$(repo-pull) Pull (Rebase With Stash)', commandId: command('pullRebaseWithStash') },
      { label: '$(git-merge) Rebase (With Stash)', commandId: command('rebaseWithStash') },
      { label: 'Worktree', kind: QuickPickItemKind.Separator },
      { label: '$(list-tree) Move to new worktree', commandId: command('moveToNewWorktree') },
      { label: 'GitHub', kind: QuickPickItemKind.Separator },
      { label: '$(repo-clone) Clone pull request…', commandId: command('clonePullRequest') },
    ];

    const selection = await window.showQuickPick(items, {
      title: 'Git Smart Checkout',
      placeHolder: 'Select an action',
    });

    if (!selection?.commandId) {
      return;
    }

    this.loggingService.info(`Status bar quick action: ${selection.commandId}`);
    await commands.executeCommand(selection.commandId);
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
