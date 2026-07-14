import { QuickPickItem, window } from 'vscode';
import { GitExecutor } from '../common/git/gitExecutor';
import { VscodeGitProvider } from '../common/git/vscodeGitProvider';
import { getWorkspaceFoldersFormatted } from '../common/vscode';
import { LoggingService } from '../logging/loggingService';
import { execCommand } from './execCommand';
import { UserCancelledError } from './userCancelledError';

type RepositoryQuickPickItem = QuickPickItem & {
  path: string;
};

export async function resolveGitRepositoryRoot(
  folderPath: string,
  logService: LoggingService
): Promise<string> {
  try {
    const { stdout } = await execCommand(
      'git',
      ['rev-parse', '--show-toplevel'],
      logService,
      { cwd: folderPath }
    );
    const repositoryRoot = stdout.trim();
    if (!repositoryRoot) {
      throw new Error('Git returned an empty repository root.');
    }
    return repositoryRoot;
  } catch {
    throw new Error(`Workspace folder "${folderPath}" is not inside a Git repository.`);
  }
}

export const getGitExecutor = async (
  logService: LoggingService,
  vscodeGitProvider?: VscodeGitProvider,
  title = 'Checkout to ...'
) => {
  const wsFolders = getWorkspaceFoldersFormatted();

  if (!wsFolders || wsFolders.length === 0) {
    throw new Error('There is no projects in current workspace.');
  }

  if (wsFolders.length === 1) {
    const repositoryRoot = await resolveGitRepositoryRoot(wsFolders[0].path, logService);
    return new GitExecutor(repositoryRoot, logService, vscodeGitProvider);
  }

  const repositoryOptions: RepositoryQuickPickItem[] = wsFolders.map((wsf) => ({
    label: wsf.name,
    description: wsf.path,
    path: wsf.path,
  }));

  const selectedOption = await window.showQuickPick(repositoryOptions, {
    placeHolder: 'Choose a repository',
    title,
  });

  if (!selectedOption) {
    throw new UserCancelledError('No repository selected');
  }

  const repositoryRoot = await resolveGitRepositoryRoot(
    (selectedOption as RepositoryQuickPickItem).path,
    logService
  );
  return new GitExecutor(repositoryRoot, logService, vscodeGitProvider);
};
