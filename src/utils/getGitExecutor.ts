import { QuickPickItem, window } from 'vscode';
import { GitExecutor } from '../common/git/gitExecutor';
import { getWorkspaceFoldersFormatted } from '../common/vscode';
import { LoggingService } from '../logging/loggingService';

export const getGitExecutor = async (logService: LoggingService) => {
  const wsFolders = getWorkspaceFoldersFormatted();

  if (!wsFolders || wsFolders.length === 0) {
    throw new Error('There is no projects in current workspace.');
  }

  if (wsFolders.length === 1) {
    return new GitExecutor(wsFolders[0].path, logService);
  }

  const repositoryOptions: QuickPickItem[] = wsFolders.map((wsf) => ({
    label: wsf.name,
  }));

  const selectedOption = await window.showQuickPick(repositoryOptions, {
    placeHolder: 'Choose a repository',
    title: 'Checkout to ...',
  });

  if (!selectedOption) {
    throw new Error('No repository selected');
  }

  const repository = wsFolders.find(({ name }) => name === selectedOption.label);

  return new GitExecutor(repository!.path, logService);
};
