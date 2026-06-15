import * as vscode from 'vscode';

import { CheckoutToCommand } from './commands/checkoutToCommand';
import { CheckoutPreviousCommand } from './commands/checkoutPreviousCommand';
import { CopyBranchNameCommand } from './commands/copyBranchNameCommand';
import { CommandManager } from './commands/commandManager';
import { PullRebaseWithStashCommand, PullWithStashCommand } from './commands/pullWithStashCommand';
import { SwitchModeCommand } from './commands/switchModeCommand';
import { StatusBarMenuCommand } from './commands/statusBarMenuCommand';
import { VscodeGitProvider } from './common/git/vscodeGitProvider';
import { ConfigurationManager } from './configuration/configurationManager';
import { EXTENSION_NAME } from './const';
import { LoggingService } from './logging/loggingService';
import { StatusBarManager } from './statusBar/statusBarManager';
import { PrCloneWebViewProvider } from './view/PrCloneWebViewProvider';
import { PrCommitsWebViewProvider } from './view/PrCommitsWebViewProvider';
import { commands } from 'vscode';
import { setContextShowPRClone, setContextShowPRCommits } from './utils/setContext';
import { PrCloneService } from './services/prCloneService';
import { getGitExecutor } from './utils/getGitExecutor';
import { GitHubClient } from './common/api/ghClient';
import { AutoStashService } from './services/autoStashService';
import { CheckoutByPRCommand } from './commands/checkoutByPRCommand';
import { PRReviewInWorktreeCommand } from './commands/prReviewInWorktreeCommand';
import {
  CopyStagedChangesToWorktreeCommand,
  CopyWipChangesToWorktreeCommand,
} from './commands/copyChangesToWorktreeCommand';
import {
  CopyWipChangesFromWorktreeCommand,
  MoveWipChangesFromWorktreeCommand,
} from './commands/copyChangesFromWorktreeCommand';
import { CreateBranchFromTemplateCommand } from './commands/createBranchFromTemplateCommand';
import { CreateTagFromTemplateCommand } from './commands/createTagFromTemplateCommand';
import { canShowCreateBranchFromTemplateCommand } from './services/branchTemplateAvailability';
import { setContextCanCreateBranchFromTemplate } from './utils/setContext';
import { MoveToNewWorktreeCommand } from './commands/moveToNewWorktreeCommand';
import { OpenWorktreeDevTerminalCommand } from './commands/openWorktreeDevTerminalCommand';
import { RemovePRReviewInWorktreeCommand } from './commands/removePRReviewInWorktreeCommand';
import { RemoveWorktreeCommand } from './commands/removeWorktreeCommand';
import { RemoveMultipleWorktreesCommand } from './commands/removeMultipleWorktreesCommand';
import { refreshRemoveMultipleWorktreesVisibility } from './commands/utils/worktreeCommandVisibility';
import { RebaseWithStashCommand } from './commands/rebaseWithStashCommand';
import { PRReviewWorktreeStore } from './services/prReviewWorktreeStore';
import { RefDetailsCache } from './services/refDetailsCache';
import { AnalyticsEvent, capture, initAnalytics, setAnalyticsEnabled, shutdownAnalytics } from './analytics/analytics';
import { randomUUID } from 'crypto';
import { showErrorMessageWithIssueAction } from './utils/errorIssueNotification';

const EXTENSION_LOADING_TIMEOUT = 250;

export function activate(context: vscode.ExtensionContext) {
  const anonymousId = context.globalState.get<string>('analytics.anonymousId') ?? (() => {
    const id = randomUUID();
    context.globalState.update('analytics.anonymousId', id);
    return id;
  })();

  const locale = vscode.env.language;

  initAnalytics(anonymousId, {
    vscode_version: vscode.version,
    extension_version: context.extension.packageJSON.version as string,
    os: process.platform,
    locale,
  });

  const commandManager = new CommandManager();

  const configManager = new ConfigurationManager();

  const updateTelemetryState = () =>
    setAnalyticsEnabled(vscode.env.isTelemetryEnabled && configManager.get().telemetry.enabled);

  updateTelemetryState();
  capture(AnalyticsEvent.ExtensionActivated);

  const logService = new LoggingService(configManager);
  const statusBarManager = new StatusBarManager(configManager, logService);
  const prCloneService = new PrCloneService(context, logService, configManager);
  const prCloneWebViewProvider = new PrCloneWebViewProvider(
    context,
    logService,
    configManager,
    prCloneService
  );
  const prCommitsWebViewProvider = new PrCommitsWebViewProvider(
    context,
    logService,
    prCloneService
  );
  const autoStashService = new AutoStashService(configManager, logService);
  const vscodeGitProvider = VscodeGitProvider.tryCreate(logService);
  const prReviewWorktreeStore = new PRReviewWorktreeStore(context.globalState, logService);
  const refDetailsCache = new RefDetailsCache(context.globalState, logService);

  logService.info(`Extension "${EXTENSION_NAME}" is now active!`);

  // Set initial context to hide PR Clone view and commits view
  setContextShowPRClone(false);
  setContextShowPRCommits(false);

  // Register commands
  const switchModeCommand = new SwitchModeCommand(statusBarManager, logService);
  const checkoutToCommand = new CheckoutToCommand(
    configManager,
    logService,
    autoStashService,
    vscodeGitProvider,
    refDetailsCache
  );
  const checkoutPreviousCommand = new CheckoutPreviousCommand(logService, autoStashService);
  const pullWithStashCommand = new PullWithStashCommand(logService, autoStashService);
  const pullRebaseWithStashCommand = new PullRebaseWithStashCommand(logService, autoStashService);

  commandManager.registerCommand(`${EXTENSION_NAME}.switchMode`, switchModeCommand);

  const statusBarMenuCommand = new StatusBarMenuCommand(statusBarManager, logService);
  commandManager.registerCommand(`${EXTENSION_NAME}.showStatusBarMenu`, statusBarMenuCommand);

  commandManager.registerCommand(`${EXTENSION_NAME}.checkoutTo`, checkoutToCommand);

  commandManager.registerCommand(`${EXTENSION_NAME}.checkoutPrevious`, checkoutPreviousCommand);

  const copyBranchNameCommand = new CopyBranchNameCommand(logService);
  commandManager.registerCommand(`${EXTENSION_NAME}.copyBranchName`, copyBranchNameCommand);

  commandManager.registerCommand(`${EXTENSION_NAME}.pullWithStash`, pullWithStashCommand);
  commandManager.registerCommand(`${EXTENSION_NAME}.pullRebaseWithStash`, pullRebaseWithStashCommand);

  const rebaseWithStashCommand = new RebaseWithStashCommand(
    configManager,
    logService,
    autoStashService,
    vscodeGitProvider,
    refDetailsCache
  );
  commandManager.registerCommand(`${EXTENSION_NAME}.rebaseWithStash`, rebaseWithStashCommand);

  const checkoutByPRCommand = new CheckoutByPRCommand(configManager, logService, autoStashService, vscodeGitProvider);
  commandManager.registerCommand(`${EXTENSION_NAME}.checkoutByPR`, checkoutByPRCommand);

  const prReviewInWorktreeCommand = new PRReviewInWorktreeCommand(
    configManager,
    logService,
    vscodeGitProvider,
    prReviewWorktreeStore
  );
  commandManager.registerCommand(`${EXTENSION_NAME}.prReviewInWorktree`, prReviewInWorktreeCommand);

  const createTagFromTemplateCommand = new CreateTagFromTemplateCommand(configManager, logService);
  commandManager.registerCommand(`${EXTENSION_NAME}.createTagFromTemplate`, createTagFromTemplateCommand);

  const createBranchFromTemplateCommand = new CreateBranchFromTemplateCommand(configManager, logService);
  commandManager.registerCommand(
    `${EXTENSION_NAME}.createBranchFromTemplate`,
    createBranchFromTemplateCommand
  );

  const refreshBranchTemplateCommandVisibility = () => {
    logService.info('[Create Branch] Re-evaluating command visibility after configuration change');
    void canShowCreateBranchFromTemplateCommand(configManager.get(), logService).then(
      (visible) => {
        logService.info(`[Create Branch] Command palette visibility set to ${visible}`);
        return setContextCanCreateBranchFromTemplate(visible);
      }
    );
  };

  void setContextCanCreateBranchFromTemplate(false);
  refreshBranchTemplateCommandVisibility();

  const moveToNewWorktreeCommand = new MoveToNewWorktreeCommand(
    configManager,
    logService,
    autoStashService,
    vscodeGitProvider,
    refDetailsCache
  );
  commandManager.registerCommand(`${EXTENSION_NAME}.moveToNewWorktree`, moveToNewWorktreeCommand);

  const removeWorktreeCommand = new RemoveWorktreeCommand(logService, vscodeGitProvider);
  commandManager.registerCommand(`${EXTENSION_NAME}.removeWorktree`, removeWorktreeCommand);

  const removeMultipleWorktreesCommand = new RemoveMultipleWorktreesCommand(logService, vscodeGitProvider);
  commandManager.registerCommand(
    `${EXTENSION_NAME}.removeMultipleWorktrees`,
    removeMultipleWorktreesCommand
  );

  const openWorktreeDevTerminalCommand = new OpenWorktreeDevTerminalCommand(logService, vscodeGitProvider);
  commandManager.registerCommand(`${EXTENSION_NAME}.openWorktreeDevTerminal`, openWorktreeDevTerminalCommand);

  const removePRReviewInWorktreeCommand = new RemovePRReviewInWorktreeCommand(
    logService,
    prReviewWorktreeStore,
    vscodeGitProvider
  );
  commandManager.registerCommand(
    `${EXTENSION_NAME}.removePRReviewInWorktree`,
    removePRReviewInWorktreeCommand
  );

  const copyStagedChangesToWorktreeCommand = new CopyStagedChangesToWorktreeCommand(logService, vscodeGitProvider);
  commandManager.registerCommand(
    `${EXTENSION_NAME}.copyStagedChangesToWorktree`,
    copyStagedChangesToWorktreeCommand
  );

  const copyWipChangesToWorktreeCommand = new CopyWipChangesToWorktreeCommand(logService, vscodeGitProvider);
  commandManager.registerCommand(
    `${EXTENSION_NAME}.copyWipChangesToWorktree`,
    copyWipChangesToWorktreeCommand
  );

  const copyWipChangesFromWorktreeCommand = new CopyWipChangesFromWorktreeCommand(logService, vscodeGitProvider);
  commandManager.registerCommand(
    `${EXTENSION_NAME}.copyWipChangesFromWorktree`,
    copyWipChangesFromWorktreeCommand
  );

  const moveWipChangesFromWorktreeCommand = new MoveWipChangesFromWorktreeCommand(logService, vscodeGitProvider);
  commandManager.registerCommand(
    `${EXTENSION_NAME}.moveWipChangesFromWorktree`,
    moveWipChangesFromWorktreeCommand
  );

  // Register clone pull request command
  const clonePullRequestCommand = commands.registerCommand(
    `${EXTENSION_NAME}.clonePullRequest`,
    async () => {
      capture(AnalyticsEvent.PrCloneOpened);

      // get exact repository
      const git = await getGitExecutor(logService);

      const repoInfo = await git.getRepoInfo();
      if (!repoInfo) {
        throw new Error('Could not determine GitHub repository information');
      }

      const ghClient = new GitHubClient(repoInfo.owner, repoInfo.repo);

      prCloneService.init(git, ghClient);

      // Show the PR Clone view by setting the context
      setContextShowPRClone(true);
      // Show the Git Smart Checkout activity bar
      commands.executeCommand(`workbench.view.extension.${EXTENSION_NAME}`);
      // TODO: change this to clear state at the moment of the first mount of App.tsx
      setTimeout(() => {
        // Wait until app fully initialized and clear webview state to start fresh
        prCloneWebViewProvider.clearState();
      }, EXTENSION_LOADING_TIMEOUT);
    }
  );

  // Set up communication between webviews
  prCloneWebViewProvider.setCommitsProvider(prCommitsWebViewProvider);

  // Register command to update selected commits (internal communication)
  const updateSelectedCommitsCommand = commands.registerCommand(
    `${EXTENSION_NAME}.updateSelectedCommits`,
    (selectedCommits: string[]) => {
      // Pass selected commits to main webview
      prCloneWebViewProvider.updateSelectedCommits(selectedCommits);
    }
  );

  // Register command to handle notifications from WebView (used by commits webview)
  const showNotificationCommand = commands.registerCommand(
    `${EXTENSION_NAME}.showNotification`,
    async (message: string, type: 'info' | 'warn' | 'error' = 'info') => {
      switch (type) {
        case 'info':
          await vscode.window.showInformationMessage(message, 'OK');
          break;
        case 'warn':
          await vscode.window.showWarningMessage(message, 'OK');
          break;
        case 'error':
          await showErrorMessageWithIssueAction(message, 'OK');
          break;
      }
    }
  );

  // Register PR Clone menu command
  const prCancelCloneMenuCommand = commands.registerCommand(
    `${EXTENSION_NAME}.prCancelCloneMenu`,
    async () => {
      await prCloneService.abortClonePR();
    }
  );

  // Register Cherry Pick PR conflicts Resolved menu command
  const prConflictsResolvedMenuCommand = commands.registerCommand(
    `${EXTENSION_NAME}.prConflictsResolvedMenu`,
    async () => {
      capture(AnalyticsEvent.PrCloneConflictsResolved);
      await prCloneService.cherryPickNext(true);
    }
  );

  // Register all commands with VS Code
  commandManager.registerAll(context);

  // Gate the "Remove Multiple Worktrees..." command on having >= 2 removable
  // worktrees. Recompute on activation and whenever the window regains focus or
  // the workspace folders change (covers worktrees added/removed externally).
  void refreshRemoveMultipleWorktreesVisibility(logService, vscodeGitProvider);
  const windowStateListener = vscode.window.onDidChangeWindowState((state) => {
    if (state.focused) {
      void refreshRemoveMultipleWorktreesVisibility(logService, vscodeGitProvider);
    }
  });
  const workspaceFoldersListener = vscode.workspace.onDidChangeWorkspaceFolders(() => {
    void refreshRemoveMultipleWorktreesVisibility(logService, vscodeGitProvider);
  });

  // Listen for configuration changes
  const configChangeListener = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(EXTENSION_NAME)) {
      configManager.reload();
      statusBarManager.onConfigurationChanged();
      updateTelemetryState();
      refreshBranchTemplateCommandVisibility();
    }
  });

  const telemetryChangeListener = vscode.env.onDidChangeTelemetryEnabled(() => updateTelemetryState());

  // Add to context subscriptions
  context.subscriptions.push(
    configChangeListener,
    windowStateListener,
    workspaceFoldersListener,
    telemetryChangeListener,
    statusBarManager,
    logService,
    { dispose: () => prCloneService.dispose() },
    clonePullRequestCommand,
    updateSelectedCommitsCommand,
    showNotificationCommand,
    prCancelCloneMenuCommand,
    prConflictsResolvedMenuCommand,
    prCloneWebViewProvider,
    prCommitsWebViewProvider,
    vscode.window.registerWebviewViewProvider(`${EXTENSION_NAME}.prClone`, prCloneWebViewProvider),
    vscode.window.registerWebviewViewProvider(
      `${EXTENSION_NAME}.prCommits`,
      prCommitsWebViewProvider
    )
  );

  // Show status bar
  statusBarManager.show();

  return { commandManager };
}

export async function deactivate() {
  console.log(`Extension "${EXTENSION_NAME}" is now deactivated!`);
  await shutdownAnalytics();
}
