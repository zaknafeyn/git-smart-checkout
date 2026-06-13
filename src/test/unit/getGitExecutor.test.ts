import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { resolveGitRepositoryRoot } from '../../utils/getGitExecutor';
import { mockLogService } from '../e2e/helpers/mockLogService';

describe('resolveGitRepositoryRoot', () => {
  const tempPaths: string[] = [];

  afterEach(() => {
    for (const tempPath of tempPaths.splice(0)) {
      fs.rmSync(tempPath, { recursive: true, force: true });
    }
  });

  function makeDirectory(prefix: string): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempPaths.push(directory);
    return directory;
  }

  function initRepository(directory: string): void {
    execFileSync('git', ['init', '-b', 'main'], { cwd: directory, stdio: 'pipe' });
  }

  it('resolves the repository root from an opened subdirectory', async () => {
    const repository = makeDirectory('gsc-root-');
    initRepository(repository);
    const subdirectory = path.join(repository, 'packages', 'app');
    fs.mkdirSync(subdirectory, { recursive: true });

    assert.strictEqual(
      await resolveGitRepositoryRoot(subdirectory, mockLogService),
      fs.realpathSync(repository)
    );
  });

  it('prefers a nested repository when its subdirectory is selected', async () => {
    const outerRepository = makeDirectory('gsc-outer-');
    initRepository(outerRepository);
    const nestedRepository = path.join(outerRepository, 'vendor', 'nested');
    fs.mkdirSync(nestedRepository, { recursive: true });
    initRepository(nestedRepository);
    const nestedSubdirectory = path.join(nestedRepository, 'src');
    fs.mkdirSync(nestedSubdirectory);

    assert.strictEqual(
      await resolveGitRepositoryRoot(nestedSubdirectory, mockLogService),
      fs.realpathSync(nestedRepository)
    );
  });

  it('reports a clear error for a folder outside a repository', async () => {
    const directory = makeDirectory('gsc-not-repo-');

    await assert.rejects(
      () => resolveGitRepositoryRoot(directory, mockLogService),
      /is not inside a Git repository/
    );
  });
});
