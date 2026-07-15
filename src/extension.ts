import * as vscode from 'vscode';

import { CheckoutToCommand } from './commands/checkoutToCommand';
import { CheckoutPreviousCommand } from './commands/checkoutPreviousCommand';
import { CopyBranchNameCommand } from './commands/copyBranchNameCommand';
import { CommandManager } from './commands/commandManager';
import { PullRebaseWithStashCommand, PullWithStashCommand } from './commands/pullWithStashCommand';
import { SwitchModeCommand } from './commands/switchModeCommand';
import { StatusBarMenuCommand } from './commands/statusBarMenuCommand';
import { OpenSettingsCommand } from './commands/openSettingsCommand';
import { VscodeGitProvider } from './common/git/vscodeGitProvider';
import {
  ConfigurationManager,
  JIRA_EMAIL_MIGRATION_NOTICE_SHOWN_KEY,
  shouldShowJiraEmailMigrationNotice,
} from './configuration/configurationManager';
import { EXTENSION_NAME } from './const';
import { LoggingService } from './logging/loggingService';
import { StatusBarManager } from './statusBar/statusBarManager';
import { PrCloneWebViewProvider } from './view/PrCloneWebViewProvider';
import { PrCommitsWebViewProvider } from './view/PrCommitsWebViewProvider';
import { commands } from 'vscode';
import { setContextShowPRClone, setContextShowPRCommits } from './utils/setContext';
import { PrCloneService } from './services/prCloneService';
import {
  IPersistedCloneOperation,
  PR_CLONE_IN_PLACE_STATE_KEY,
} from './services/prCloneInPlaceService';
import { getGitExecutor, resolveGitRepositoryRoot } from './utils/getGitExecutor';
import { GitExecutor } from './common/git/gitExecutor';
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
import { PreviewTemplateCommand } from './commands/previewTemplateCommand';
import { SetJiraTokenCommand } from './commands/setJiraTokenCommand';
import { InitJiraCommand } from './commands/initJiraCommand';
import { CreateTagFromTemplateCommand } from './commands/createTagFromTemplateCommand';
import {
  canShowCreateBranchFromTemplateCommand,
  canShowPreviewTemplateCommand,
} from './services/branchTemplateAvailability';
import { ScriptConsentStore } from './services/scriptConsentStore';
import {
  setContextCanCreateBranchFromTemplate,
  setContextCanPreviewTemplate,
  setContextHasRepository,
} from './utils/setContext';
import { MoveToNewWorktreeCommand } from './commands/moveToNewWorktreeCommand';
import { OpenWorktreeDevTerminalCommand } from './commands/openWorktreeDevTerminalCommand';
import { ManageAutoStashesCommand } from './commands/manageAutoStashesCommand';
import { CleanupBranchesCommand } from './commands/cleanupBranchesCommand';
import { RemovePRReviewInWorktreeCommand } from './commands/removePRReviewInWorktreeCommand';
import { RemoveWorktreeCommand } from './commands/removeWorktreeCommand';
import { RemoveMultipleWorktreesCommand } from './commands/removeMultipleWorktreesCommand';
import { refreshRemoveMultipleWorktreesVisibility } from './commands/utils/worktreeCommandVisibility';
import { RebaseWithStashCommand } from './commands/rebaseWithStashCommand';
import { PRReviewWorktreeStore } from './services/prReviewWorktreeStore';
import { RefDetailsCache } from './services/refDetailsCache';
import { WorktreeSetupService } from './services/worktreeSetupService';
import { AnalyticsEvent, capture, initAnalytics, setAnalyticsEnabled, shutdownAnalytics } from './analytics/analytics';
import { randomUUID } from 'crypto';
import { showErrorMessageWithIssueAction } from './utils/errorIssueNotification';
import { UserCancelledError } from './utils/userCancelledError';
import { WorktreeTreeDataProvider } from './view/WorktreeTreeDataProvider';
import { UpdateNotificationService } from './services/updateNotificationService';
import { WorktreeTreeActionCommand } from './commands/worktreeTreeActionCommand';

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

  const configManager = new ConfigurationManager(context.secrets);
  const updateNotificationService = new UpdateNotificationService();
  void updateNotificationService.checkOnActivation(context, configManager.get().showWhatsNew);

  const updateTelemetryState = () =>
    setAnalyticsEnabled(vscode.env.isTelemetryEnabled && configManager.get().telemetry.enabled);

  updateTelemetryState();
  capture(AnalyticsEvent.ExtensionActivated);

  const jiraEmailMigrationNoticeShown = context.globalState.get<boolean>(
    JIRA_EMAIL_MIGRATION_NOTICE_SHOWN_KEY,
    false
  );
  if (
    shouldShowJiraEmailMigrationNotice(
      configManager.isUsingDeprecatedJiraEmailSetting(),
      jiraEmailMigrationNoticeShown
    )
  ) {
    context.globalState.update(JIRA_EMAIL_MIGRATION_NOTICE_SHOWN_KEY, true);
    vscode.window
      .showInformationMessage(
        'Git Smart Checkout: the "jira.email" setting is deprecated. Please migrate to "jira.username".',
        'Open Settings'
      )
      .then((selection) => {
        if (selection === 'Open Settings') {
          commands.executeCommand(`${EXTENSION_NAME}.openSettings`);
        }
      });
  }

  const logService = new LoggingService(configManager);
  const worktreeSetupService = new WorktreeSetupService(configManager, logService, context.workspaceState);
  const vscodeGitProvider = VscodeGitProvider.tryCreate(logService);
  const prReviewWorktreeStore = new PRReviewWorktreeStore(context.globalState, logService);
  const worktreeTreeDataProvider = new WorktreeTreeDataProvider(logService, prReviewWorktreeStore, vscodeGitProvider);
  commandManager.registerCommand(`${EXTENSION_NAME}.worktree.open`, new WorktreeTreeActionCommand('open', logService, vscodeGitProvider));
  commandManager.registerCommand(`${EXTENSION_NAME}.worktree.terminal`, new WorktreeTreeActionCommand('terminal', logService, vscodeGitProvider));
  commandManager.registerCommand(
    `${EXTENSION_NAME}.worktree.copyWip`,
    new WorktreeTreeActionCommand('copyWip', logService, vscodeGitProvider),
    { mutatesWorktrees: true }
  );
  commandManager.registerCommand(
    `${EXTENSION_NAME}.worktree.remove`,
    new WorktreeTreeActionCommand('remove', logService, vscodeGitProvider),
    { mutatesWorktrees: true }
  );
  commandManager.registerCommand(`${EXTENSION_NAME}.worktree.addToWorkspace`, new WorktreeTreeActionCommand('addToWorkspace', logService, vscodeGitProvider));
  commandManager.registerCommand(`${EXTENSION_NAME}.worktree.copyPath`, new WorktreeTreeActionCommand('copyPath', logService, vscodeGitProvider));
  commandManager.registerCommand(`${EXTENSION_NAME}.worktree.reveal`, new WorktreeTreeActionCommand('reveal', logService, vscodeGitProvider));
  commandManager.registerCommand(`${EXTENSION_NAME}.worktree.refresh`, {
    execute: async () => worktreeTreeDataProvider.refresh(),
  });
  commandManager.setOnCommandCompleted(() => worktreeTreeDataProvider.refreshDebounced());
  const statusBarManager = new StatusBarManager(
    configManager,
    logService,
    prReviewWorktreeStore,
    vscodeGitProvider
  );
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
  const autoStashService = new AutoStashService(configManager, logService, () =>
    void updateNotificationService.recordStashCarryingCheckoutSuccess(context)
  );
  const refDetailsCache = new RefDetailsCache(context.globalState, logService);

  logService.info(`Extension "${EXTENSION_NAME}" is now active!`);

  // Check for a PR clone that was left mid-cherry-pick if the window closed/crashed while
  // paused on conflicts, before unconditionally resetting the PR-clone contexts below. This
  // check is async (spawns git) and cannot block synchronous activation; if it finds a
  // resumable operation it re-sets the contexts, which simply lands a moment after the
  // unconditional reset below (no repository/persisted state is at risk in the interim).
  void checkForInterruptedPrClone(
    context,
    logService,
    vscodeGitProvider,
    prCloneService
  );

  // Set initial context to hide PR Clone view and commits view
  setContextShowPRClone(false);
  setContextShowPRCommits(false);
  void refreshRepositoryContext(logService);

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

  const openSettingsCommand = new OpenSettingsCommand(logService);
  commandManager.registerCommand(`${EXTENSION_NAME}.openSettings`, openSettingsCommand);

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
    prReviewWorktreeStore,
    worktreeSetupService
  );
  commandManager.registerCommand(`${EXTENSION_NAME}.prReviewInWorktree`, prReviewInWorktreeCommand, {
    mutatesWorktrees: true,
  });

  const createTagFromTemplateCommand = new CreateTagFromTemplateCommand(configManager, logService);
  commandManager.registerCommand(`${EXTENSION_NAME}.createTagFromTemplate`, createTagFromTemplateCommand);

  const createBranchFromTemplateCommand = new CreateBranchFromTemplateCommand(configManager, logService);
  commandManager.registerCommand(
    `${EXTENSION_NAME}.createBranchFromTemplate`,
    createBranchFromTemplateCommand
  );
  const scriptConsentStore = new ScriptConsentStore(context.workspaceState);
  commandManager.registerCommand(
    `${EXTENSION_NAME}.previewTemplate`,
    new PreviewTemplateCommand(configManager, logService, scriptConsentStore)
  );

  const setJiraTokenCommand = new SetJiraTokenCommand(configManager, logService);
  commandManager.registerCommand(`${EXTENSION_NAME}.setJiraToken`, setJiraTokenCommand);

  const initJiraCommand = new InitJiraCommand(configManager, logService);
  commandManager.registerCommand(`${EXTENSION_NAME}.initJira`, initJiraCommand);

  const refreshPreviewTemplateCommandVisibility = () => {
    const visible = canShowPreviewTemplateCommand(configManager.get(), logService);
    void setContextCanPreviewTemplate(visible);
  };

  const refreshBranchTemplateCommandVisibility = () => {
    logService.info('[Create Branch] Re-evaluating command visibility after configuration change');
    void canShowCreateBranchFromTemplateCommand(configManager.get(), logService).then(
      (visible) => {
        logService.info(`[Create Branch] Command palette visibility set to ${visible}`);
        return setContextCanCreateBranchFromTemplate(visible);
      }
    );
    refreshPreviewTemplateCommandVisibility();
  };

  void setContextCanCreateBranchFromTemplate(false);
  void setContextCanPreviewTemplate(false);
  refreshBranchTemplateCommandVisibility();

  // Migrate any legacy plaintext Jira token into Secret Storage, then load it
  // and keep command visibility in sync with external token changes.
  void configManager.initJiraToken(refreshBranchTemplateCommandVisibility).then(
    (subscription) => {
      context.subscriptions.push(subscription);
      refreshBranchTemplateCommandVisibility();
    },
    (error) => logService.error('[Jira] Failed to initialize Jira token storage', error)
  );

  const moveToNewWorktreeCommand = new MoveToNewWorktreeCommand(
    configManager,
    logService,
    autoStashService,
    vscodeGitProvider,
    refDetailsCache,
    worktreeSetupService
  );
  commandManager.registerCommand(`${EXTENSION_NAME}.moveToNewWorktree`, moveToNewWorktreeCommand, {
    mutatesWorktrees: true,
  });

  const removeWorktreeCommand = new RemoveWorktreeCommand(logService, vscodeGitProvider);
  commandManager.registerCommand(`${EXTENSION_NAME}.removeWorktree`, removeWorktreeCommand, {
    mutatesWorktrees: true,
  });

  const removeMultipleWorktreesCommand = new RemoveMultipleWorktreesCommand(logService, vscodeGitProvider);
  commandManager.registerCommand(
    `${EXTENSION_NAME}.removeMultipleWorktrees`,
    removeMultipleWorktreesCommand,
    { mutatesWorktrees: true }
  );

  const openWorktreeDevTerminalCommand = new OpenWorktreeDevTerminalCommand(logService, vscodeGitProvider);
  commandManager.registerCommand(`${EXTENSION_NAME}.openWorktreeDevTerminal`, openWorktreeDevTerminalCommand);

  const manageAutoStashesCommand = new ManageAutoStashesCommand(logService, vscodeGitProvider);
  commandManager.registerCommand(`${EXTENSION_NAME}.manageAutoStashes`, manageAutoStashesCommand);
  commandManager.registerCommand(`${EXTENSION_NAME}.cleanupBranches`, new CleanupBranchesCommand(logService, vscodeGitProvider));

  const removePRReviewInWorktreeCommand = new RemovePRReviewInWorktreeCommand(
    logService,
    prReviewWorktreeStore,
    vscodeGitProvider
  );
  commandManager.registerCommand(
    `${EXTENSION_NAME}.removePRReviewInWorktree`,
    removePRReviewInWorktreeCommand,
    { mutatesWorktrees: true }
  );

  const copyStagedChangesToWorktreeCommand = new CopyStagedChangesToWorktreeCommand(logService, vscodeGitProvider);
  commandManager.registerCommand(
    `${EXTENSION_NAME}.copyStagedChangesToWorktree`,
    copyStagedChangesToWorktreeCommand,
    { mutatesWorktrees: true }
  );

  const copyWipChangesToWorktreeCommand = new CopyWipChangesToWorktreeCommand(logService, vscodeGitProvider);
  commandManager.registerCommand(
    `${EXTENSION_NAME}.copyWipChangesToWorktree`,
    copyWipChangesToWorktreeCommand,
    { mutatesWorktrees: true }
  );

  const copyWipChangesFromWorktreeCommand = new CopyWipChangesFromWorktreeCommand(logService, vscodeGitProvider);
  commandManager.registerCommand(
    `${EXTENSION_NAME}.copyWipChangesFromWorktree`,
    copyWipChangesFromWorktreeCommand,
    { mutatesWorktrees: true }
  );

  const moveWipChangesFromWorktreeCommand = new MoveWipChangesFromWorktreeCommand(logService, vscodeGitProvider);
  commandManager.registerCommand(
    `${EXTENSION_NAME}.moveWipChangesFromWorktree`,
    moveWipChangesFromWorktreeCommand,
    { mutatesWorktrees: true }
  );

  // Register clone pull request command
  const clonePullRequestCommand = commands.registerCommand(
    `${EXTENSION_NAME}.clonePullRequest`,
    async () => {
      try {
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
        // Reset the webview to a fresh state: immediately if it's already
        // visible, or as soon as it finishes mounting (WEBVIEW_READY handshake).
        prCloneWebViewProvider.requestFreshStart();
      } catch (error) {
        if (error instanceof UserCancelledError) {
          return;
        }
        const errorMessage = error instanceof Error ? error.message : String(error);
        await showErrorMessageWithIssueAction(`Command failed: ${errorMessage}`, 'OK');
        console.error(`Error executing command ${EXTENSION_NAME}.clonePullRequest:`, error);
      }
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
      // Debounced: rapid focus toggling (e.g. alt-tabbing) collapses into a
      // single reload rather than one per focus event.
      worktreeTreeDataProvider.refreshDebounced();
    }
  });
  const workspaceFoldersListener = vscode.workspace.onDidChangeWorkspaceFolders(() => {
    void refreshRemoveMultipleWorktreesVisibility(logService, vscodeGitProvider);
    void refreshRepositoryContext(logService);
    worktreeTreeDataProvider.refresh();
  });
  // Keep the tree in sync with checkouts/commits/stash operations performed
  // outside this extension (VS Code's built-in Source Control view, terminal
  // git commands, etc.) by listening to vscode.git repository state changes.
  const gitStateListener = vscodeGitProvider?.onDidChangeAnyRepositoryState(() => {
    worktreeTreeDataProvider.refreshDebounced();
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
    ...(gitStateListener ? [gitStateListener] : []),
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
    ),
    vscode.window.registerTreeDataProvider(`${EXTENSION_NAME}.worktrees`, worktreeTreeDataProvider),
    worktreeTreeDataProvider
  );

  // Show status bar
  statusBarManager.show();

  // `context` and `updateNotificationService` are exposed alongside `commandManager` so
  // e2e tests can exercise the exact activation-time notification logic (seeding
  // globalState, invoking checkOnActivation) against the real extension context.
  return { commandManager, context, updateNotificationService };
}

async function refreshRepositoryContext(logService: LoggingService): Promise<void> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const hasRepository = (await Promise.all(folders.map(async (folder) => {
    try {
      await resolveGitRepositoryRoot(folder.uri.fsPath, logService);
      return true;
    } catch {
      return false;
    }
  }))).some(Boolean);
  await setContextHasRepository(hasRepository);
}

/**
 * On activation, check whether an in-place PR clone was left mid-cherry-pick by a window
 * close/crash/reload while paused on conflicts (issue: "No recovery path if VS Code closes
 * mid in-place clone"). If so, offer the user a Resume/Abort-and-restore choice instead of
 * silently stranding the repo on the `<feature>_clone` branch with the original work stashed.
 */
/**
 * Resolve a `GitExecutor` for the repository a persisted clone record belongs to, by matching
 * it against the currently-open workspace folders. Exported separately so tests can stub the
 * resolution without needing a real multi-root workspace.
 */
export async function resolveGitExecutorForRepoPath(
  repoPath: string,
  logService: LoggingService,
  vscodeGitProvider: VscodeGitProvider | undefined
): Promise<GitExecutor | undefined> {
  const wsFolders = vscode.workspace.workspaceFolders ?? [];
  for (const folder of wsFolders) {
    try {
      const repoRoot = await resolveGitRepositoryRoot(folder.uri.fsPath, logService);
      if (repoRoot === repoPath) {
        return new GitExecutor(repoRoot, logService, vscodeGitProvider);
      }
    } catch {
      // Folder isn't a git repository (or isn't resolvable yet); keep looking.
    }
  }

  return undefined;
}

export async function checkForInterruptedPrClone(
  context: vscode.ExtensionContext,
  logService: LoggingService,
  vscodeGitProvider: VscodeGitProvider | undefined,
  prCloneService: PrCloneService,
  resolveGitForRecord: (
    record: IPersistedCloneOperation
  ) => Promise<GitExecutor | undefined> = (record) =>
    resolveGitExecutorForRepoPath(record.repoPath, logService, vscodeGitProvider)
): Promise<void> {
  const record = context.workspaceState.get<IPersistedCloneOperation>(
    PR_CLONE_IN_PLACE_STATE_KEY
  );
  if (!record) {
    return;
  }

  const matchedGit = await resolveGitForRecord(record);

  if (!matchedGit) {
    // The repo this record belongs to isn't open in this workspace right now; leave the
    // record in place in case it's opened in a future activation.
    return;
  }

  const cherryPickInProgress = await matchedGit.isCherryPickInProgress();
  if (!cherryPickInProgress) {
    // The user must have resolved (or aborted) this manually via the git CLI before
    // reopening. There's nothing to recover, so just clear the stale record silently.
    await context.workspaceState.update(PR_CLONE_IN_PLACE_STATE_KEY, undefined);
    return;
  }

  const choice = await vscode.window.showWarningMessage(
    `A PR clone of #${record.prNumber} was interrupted. Resume or abort and restore your original state?`,
    'Resume',
    'Abort and restore'
  );

  if (choice !== 'Resume' && choice !== 'Abort and restore') {
    return;
  }

  const repoInfo = await matchedGit.getRepoInfo();
  if (!repoInfo) {
    logService.warn(
      'Could not determine GitHub repository information while recovering an interrupted PR clone.'
    );
    return;
  }

  const ghClient = new GitHubClient(repoInfo.owner, repoInfo.repo);
  prCloneService.init(matchedGit, ghClient);

  if (choice === 'Resume') {
    await prCloneService.InPlaceService.resumeOperation(record);
    await commands.executeCommand(`workbench.view.extension.${EXTENSION_NAME}`);
  } else {
    await prCloneService.InPlaceService.abortFromPersistedState(record);
  }
}

export async function deactivate() {
  console.log(`Extension "${EXTENSION_NAME}" is now deactivated!`);
  await shutdownAnalytics();
}
