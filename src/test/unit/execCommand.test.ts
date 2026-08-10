import * as assert from 'assert';

import { execCommand } from '../../utils/execCommand';
import { mockLogService } from '../e2e/helpers/mockLogService';

describe('execCommand', () => {
  it('pins LC_ALL and LANG to C so git output cannot be localized', async () => {
    const { stdout } = await execCommand(
      process.execPath,
      ['-e', 'process.stdout.write(`${process.env.LC_ALL}|${process.env.LANG}`)'],
      mockLogService,
      { env: { ...process.env, LC_ALL: 'de_DE.UTF-8', LANG: 'de_DE.UTF-8' } }
    );

    assert.strictEqual(stdout, 'C|C');
  });

  it('preserves other options such as cwd while pinning the locale', async () => {
    const { stdout } = await execCommand(
      process.execPath,
      ['-e', 'process.stdout.write(process.cwd())'],
      mockLogService,
      { cwd: __dirname }
    );

    assert.strictEqual(stdout, __dirname);
  });
});
