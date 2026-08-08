import {
  commands,
  Disposable,
  MarkdownString,
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
import { VscodeGitProvider } from '../common/git/vscodeGitProvider';
import { PRReviewWorktreeStore } from '../services/prReviewWorktreeStore';
import {
  gatherWorktreeQuickActionsState,
  WorktreeQuickActionsState,
} from './quickActionsState';

export interface StackBranchMeta {
  prNumber?: number;
  needsRestack?: boolean;
}

/** Data needed to render the status bar stack indicator for the current branch. */
export interface StackIndicatorData {
  /** Branches in the current branch's stack, bottom (closest to trunk) to top. */
  orderedBranches: string[];
  currentBranch: string;
  info: Map<string, StackBranchMeta>;
}

export interface StackPosition {
  /** 1-based position, bottom of the stack = 1. */
  position: number;
  size: number;
}

/**
 * Computes the current branch's 1-based position within its stack
 * (bottom = 1) and the stack's total size, from a bottom-to-top ordered
 * branch list. Returns undefined when the branch isn't in the list. Pure
 * and unit-testable.
 */
export function computeStackPosition(
  currentBranch: string,
  orderedBottomToTop: string[]
): StackPosition | undefined {
  const index = orderedBottomToTop.indexOf(currentBranch);
  if (index === -1) {
    return undefined;
  }
  return { position: index + 1, size: orderedBottomToTop.length };
}

/** Formats a stack position as e.g. "2/3". Pure. */
export function formatStackPosition(position: number, size: number): string {
  return `${position}/${size}`;
}

export interface StackIndicatorVisibilityInputs {
  stacksEnabled: boolean;
  showStatusBar: boolean;
  isDetached: boolean;
  isInStack: boolean;
}

/**
 * Whether the stack status bar indicator should be shown: stacks must be
 * enabled, the extension's status bar must be enabled, HEAD must not be
 * detached, and the current branch must actually be a member of a stack.
 * Pure and unit-testable.
 */
export function shouldShowStackIndicator(inputs: StackIndicatorVisibilityInputs): boolean {
  return inputs.stacksEnabled && inputs.showStatusBar && !inputs.isDetached && inputs.isInStack;
}

interface QuickActionItem extends QuickPickItem {
  commandId?: string;
  /** Whether the item is shown; defaults to true when omitted. */
  visible?: boolean;
}

interface ModeQuickPickItem extends QuickPickItem {
  mode: TAutoStashModeConfig;
}

export function getStatusBarBackgroundColor(
  mode: TAutoStashModeConfig
): ThemeColor | undefined {
  return mode === AUTO_STASH_MODE_MANUAL
    ? undefined
    : new ThemeColor('statusBarItem.warningBackground');
}

/**
 * Builds the Mode QuickPick item list. Each item carries the actual `mode`
 * value so the selection handler can read it directly instead of re-parsing
 * the display label. Pure (no VS Code interaction) so it can be unit-tested.
 */
export function buildModeQuickPickItems(
  currentMode: TAutoStashModeConfig
): ModeQuickPickItem[] {
  return AUTO_STASH_MODES.map((mode) => {
    const modeDetails = AUTO_STASH_MODES_DETAILS[mode];
    return {
      label: `${modeDetails.icon} ${modeDetails.label}`,
      description: modeDetails.description,
      detail: currentMode === mode ? 'Currently active' : undefined,
      mode,
    };
  });
}

/**
 * Builds the full quick-actions item list. Condition-dependent items carry a
 * `visible` flag derived from {@link WorktreeQuickActionsState}; everything else
 * is always visible. Pure (no VS Code interaction) so it can be unit-tested.
 */
export function buildQuickActionItems(
  modeBriefLabel: string,
  state: WorktreeQuickActionsState
): QuickActionItem[] {
  const command = (name: string) => `${EXTENSION_NAME}.${name}`;

  return [
    { label: 'Stash mode', kind: QuickPickItemKind.Separator },
    {
      label: '$(gear) Switch stash mode',
      description: `Current: ${modeBriefLabel}`,
      commandId: command('switchMode'),
    },
    { label: 'Checkout', kind: QuickPickItemKind.Separator },
    { label: '$(arrow-swap) Checkout to…', commandId: command('checkoutTo') },
    { label: '$(history) Checkout previous branch', commandId: command('checkoutPrevious') },
    {
      label: '$(git-pull-request) Checkout by PR number…',
      commandId: command('checkoutByPR'),
      visible: state.isGitHubRepo,
    },
    { label: '$(git-branch) Create branch from template…', commandId: command('createBranchFromTemplate') },
    { label: '$(tag) Create tag from template…', commandId: command('createTagFromTemplate') },
    { label: 'Branches', kind: QuickPickItemKind.Separator },
    { label: '$(trash) Delete merged branches…', commandId: command('cleanupBranches') },
    { label: 'Update branch', kind: QuickPickItemKind.Separator },
    { label: '$(repo-pull) Pull (With Stash)', commandId: command('pullWithStash') },
    { label: '$(repo-pull) Pull (Rebase With Stash)', commandId: command('pullRebaseWithStash') },
    { label: '$(git-merge) Rebase (With Stash)', commandId: command('rebaseWithStash') },
    { label: 'Worktree', kind: QuickPickItemKind.Separator },
    { label: '$(list-tree) Move to new worktree', commandId: command('moveToNewWorktree') },
    { label: '$(eye) PR review in worktree…', commandId: command('prReviewInWorktree') },
    {
      label: '$(git-pull-request) Review PR by number…',
      commandId: command('reviewPrByNumber'),
      visible: state.isGitHubRepo,
    },
    {
      label: '$(terminal) Open worktree dev terminal…',
      commandId: command('openWorktreeDevTerminal'),
    },
    { label: 'Worktree changes', kind: QuickPickItemKind.Separator },
    {
      label: '$(diff-added) Copy staged changes to worktree…',
      commandId: command('copyStagedChangesToWorktree'),
      visible: state.canCopyStagedToWorktree,
    },
    {
      label: '$(copy) Copy WIP changes to worktree…',
      commandId: command('copyWipChangesToWorktree'),
      visible: state.canCopyWipToWorktree,
    },
    {
      label: '$(arrow-left) Copy WIP from worktree…',
      commandId: command('copyWipChangesFromWorktree'),
      visible: state.hasOtherWorktree,
    },
    {
      label: '$(arrow-right) Move WIP from worktree…',
      commandId: command('moveWipChangesFromWorktree'),
      visible: state.hasOtherWorktree,
    },
    { label: 'Remove worktrees', kind: QuickPickItemKind.Separator },
    {
      label: '$(trash) Remove worktree…',
      commandId: command('removeWorktree'),
      visible: state.hasRemovableWorktree,
    },
    {
      label: '$(trash) Remove multiple worktrees…',
      commandId: command('removeMultipleWorktrees'),
      visible: state.hasMultipleRemovableWorktrees,
    },
    {
      label: '$(trash) Remove PR review worktree…',
      commandId: command('removePRReviewInWorktree'),
      visible: state.hasPRReviewWorktree,
    },
    { label: 'GitHub', kind: QuickPickItemKind.Separator },
    {
      label: '$(repo-clone) Clone pull request…',
      commandId: command('clonePullRequest'),
      visible: state.isGitHubRepo,
    },
    { label: 'Settings', kind: QuickPickItemKind.Separator },
    { label: '$(settings-gear) Open settings', commandId: command('openSettings') },
  ];
}

/**
 * Drops items hidden via `visible === false`, then removes section separators
 * that no longer head at least one action item (prevents orphaned headers such
 * as "Worktree changes" or "Remove worktrees"). Pure and unit-testable.
 */
export function filterVisibleQuickActions(items: QuickActionItem[]): QuickActionItem[] {
  const shown = items.filter((item) => item.visible !== false);

  return shown.filter((item, index) => {
    if (item.kind !== QuickPickItemKind.Separator) {
      return true;
    }

    // Keep this separator only if an action item follows before the next separator.
    for (let next = index + 1; next < shown.length; next++) {
      if (shown[next].kind === QuickPickItemKind.Separator) {
        return false;
      }
      return true;
    }

    return false;
  });
}

export class StatusBarManager implements Disposable {
  private statusBarItem: StatusBarItem;
  private configManager: ConfigurationManager;
  private loggingService: LoggingService;
  private prReviewWorktreeStore: PRReviewWorktreeStore;
  private vscodeGitProvider?: VscodeGitProvider;
  /** Stack indicator, priority = mode item priority + 1 so it renders immediately to the left. */
  private stackStatusBarItem: StatusBarItem;
  private stackIndicatorData: StackIndicatorData | undefined;

  constructor(
    configManager: ConfigurationManager,
    loggingService: LoggingService,
    prReviewWorktreeStore: PRReviewWorktreeStore,
    vscodeGitProvider?: VscodeGitProvider
  ) {
    this.configManager = configManager;
    this.loggingService = loggingService;
    this.prReviewWorktreeStore = prReviewWorktreeStore;
    this.vscodeGitProvider = vscodeGitProvider;

    this.statusBarItem = window.createStatusBarItem(StatusBarAlignment.Right, 100);

    this.statusBarItem.command = `${EXTENSION_NAME}.showStatusBarMenu`;

    // Higher priority renders further left for items on the same alignment
    // side, so 101 lands immediately to the left of the mode item (100).
    this.stackStatusBarItem = window.createStatusBarItem(StatusBarAlignment.Right, 101);
    this.stackStatusBarItem.command = `${EXTENSION_NAME}.stacks.focus`;

    this.updateStatusBar();
    this.updateStackIndicator();
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

  /**
   * Updates the stack indicator from freshly-computed data (or `undefined`
   * when the current branch isn't part of any stack / HEAD is detached).
   * Call after stack detection runs and on branch/HEAD changes.
   */
  public setStackIndicator(data: StackIndicatorData | undefined): void {
    this.stackIndicatorData = data;
    this.updateStackIndicator();
  }

  private updateStackIndicator(): void {
    const config = this.configManager.get();
    const data = this.stackIndicatorData;

    const visible = shouldShowStackIndicator({
      stacksEnabled: config.stacks.enabled,
      showStatusBar: config.showStatusBar,
      isDetached: !data,
      isInStack: !!data,
    });

    if (!visible || !data) {
      this.stackStatusBarItem.hide();
      return;
    }

    const position = computeStackPosition(data.currentBranch, data.orderedBranches);
    if (!position) {
      this.stackStatusBarItem.hide();
      return;
    }

    this.stackStatusBarItem.text = `$(layers) ${formatStackPosition(position.position, position.size)}`;

    const tooltipLines = [
      '**Stack**',
      ...[...data.orderedBranches]
        .reverse() // top-down for the tooltip; orderedBranches is bottom-to-top.
        .map((branch) => {
          const marker = branch === data.currentBranch ? '→ ' : ' ';
          const meta = data.info.get(branch);
          const prPart = meta?.prNumber ? ` PR #${meta.prNumber}` : '';
          const restackPart = meta?.needsRestack ? ' • needs restack' : '';
          return `${marker}${branch}${prPart}${restackPart}`;
        }),
    ];
    this.stackStatusBarItem.tooltip = new MarkdownString(tooltipLines.join('\n\n'));

    this.stackStatusBarItem.show();
  }

  public async showModeQuickPick(): Promise<void> {
    const config = this.configManager.get();
    const currentMode = config.mode;

    const items: ModeQuickPickItem[] = buildModeQuickPickItems(currentMode);

    const selection = await window.showQuickPick(items, {
      title: 'Select Auto Stash Checkout Mode',
      placeHolder: 'Choose the operating mode for your extension',
    });

    if (!selection) {
      return;
    }

    this.loggingService.info(`Auto Stash Checkout Mode: ${selection?.label}`);

    const newMode = selection.mode;

    this.loggingService.info(`New mode: ${newMode}`);

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

    const state = await gatherWorktreeQuickActionsState(
      this.loggingService,
      this.prReviewWorktreeStore,
      this.vscodeGitProvider
    );
    const items = filterVisibleQuickActions(
      buildQuickActionItems(modeDetails.briefLabel, state)
    );

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
    this.stackStatusBarItem.hide();
  }

  public onConfigurationChanged(): void {
    this.updateStatusBar();
    this.updateStackIndicator();
  }

  public dispose(): void {
    this.statusBarItem.dispose();
    this.stackStatusBarItem.dispose();
  }
}
