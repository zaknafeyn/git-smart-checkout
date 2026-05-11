import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export async function selectWorktreePath(
  repositoryPath: string,
  targetBranchName: string,
  configuredDirectory: string,
  title: string
): Promise<string | undefined> {
  const baseDirectory = getBaseWorktreeDirectory(repositoryPath, configuredDirectory);
  const suggestedDirectoryName = getSuggestedDirectoryName(repositoryPath, targetBranchName);

  const directoryName = await vscode.window.showInputBox({
    title,
    prompt: `Create worktree in ${baseDirectory}`,
    placeHolder: 'Worktree directory name',
    value: suggestedDirectoryName,
    validateInput: (value) => {
      const trimmed = value.trim();

      if (!trimmed) {
        return 'Worktree directory name is required.';
      }

      if (path.isAbsolute(trimmed) || trimmed.includes('/') || trimmed.includes('\\')) {
        return 'Provide a folder name, not a path.';
      }

      const targetPath = path.join(baseDirectory, trimmed);
      if (fs.existsSync(targetPath)) {
        return 'A folder with this name already exists.';
      }

      return undefined;
    },
  });

  if (!directoryName) {
    return undefined;
  }

  return path.join(baseDirectory, directoryName.trim());
}

export function getBaseWorktreeDirectory(
  repositoryPath: string,
  configuredDirectory: string
): string {
  const trimmedDirectory = configuredDirectory.trim();
  const fallbackDirectory = path.dirname(repositoryPath);

  if (!trimmedDirectory) {
    return fallbackDirectory;
  }

  const expandedDirectory = trimmedDirectory.startsWith('~')
    ? path.join(process.env.HOME ?? '', trimmedDirectory.slice(1))
    : trimmedDirectory;

  return path.isAbsolute(expandedDirectory)
    ? expandedDirectory
    : path.resolve(fallbackDirectory, expandedDirectory);
}

export function getSuggestedDirectoryName(repositoryPath: string, targetBranchName: string): string {
  const repositoryName = path.basename(repositoryPath);
  const safeBranchName = targetBranchName
    .replace(/[\\/]+/g, '-')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return `${repositoryName}-${safeBranchName || 'worktree'}`;
}
