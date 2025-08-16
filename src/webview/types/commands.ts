// this file should contain the same contents as src/types/webviewCommands.ts

export enum WebviewCommand {
  // Commands sent from webview to extension
  FETCH_PR = 'fetchPR',
  CLONE_PR = 'clonePR',
  SELECT_TARGET_BRANCH = 'selectTargetBranch',
  CANCEL_PR_CLONE = 'cancelPRClone',
  HIDE_COMMITS_WEBVIEW = 'hideCommitsWebview',
  SHOW_NOTIFICATION = 'showNotification',
  LOG = 'log',
  SHOW_CONFIRMATION_DIALOG = 'showConfirmationDialog',
  TOGGLE_COMMIT = 'toggleCommit',
  SELECT_ALL_COMMITS = 'selectAllCommits',
  DESELECT_ALL_COMMITS = 'deselectAllCommits',
  COPY_COMMITS_TO_CLIPBOARD = 'copyCommitsToClipboard',
  WEBVIEW_READY = 'webviewReady',

  // Commands sent from extension to webview
  SHOW_PR_DATA = 'showPRData',
  TARGET_BRANCH_SELECTED = 'targetBranchSelected',
  CLEAR_STATE = 'clearState',
  UPDATE_LOADING_STATE = 'updateLoadingState',
  UPDATE_SELECTED_COMMITS = 'updateSelectedCommits',
  UPDATE_COMMITS = 'updateCommits',
}
