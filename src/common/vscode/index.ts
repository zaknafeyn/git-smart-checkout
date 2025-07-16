import { workspace } from 'vscode';

export const getCurrentVsCodeFolder = () => {
  // Get the currently opened folder
  const workspaceFolders = workspace.workspaceFolders;
  if (!workspaceFolders) {
    return;
  }

  return workspaceFolders[0].uri.fsPath;
};

export const getWorkspaceFoldersFormatted = (): { name: string; path: string }[] | undefined => {
  const workspaceFolders = workspace.workspaceFolders;
  if (!workspaceFolders) {
    return;
  }

  return workspaceFolders.map((wsf) => ({ name: wsf.name, path: wsf.uri.fsPath }));
};
