import * as assert from 'assert';
import * as path from 'path';

describe('release type', () => {
  let releaseType: (channel: 'pre' | 'stable', lastVersion?: string) => string;

  before(async () => {
    const modulePath = path.join(__dirname, '..', '..', '..', 'scripts', 'nextReleaseType.mjs');
    ({ releaseType } = await import(modulePath));
  });

  it('bumps the pre-release channel to the next odd minor after a stable release', () => {
    assert.strictEqual(releaseType('pre', '0.16.1'), 'minor');
  });

  it('bumps the pre-release channel to a patch while the minor is already odd', () => {
    assert.strictEqual(releaseType('pre', '0.17.0'), 'patch');
  });

  it('bumps to a minor when there is no prior release', () => {
    assert.strictEqual(releaseType('pre', undefined), 'minor');
  });

  it('forces a stable minor to jump over an odd pre-release corridor', () => {
    assert.strictEqual(releaseType('stable', '0.17.3'), 'minor');
  });

  it('defers to commit-analyzer for a stable release following an even minor', () => {
    assert.strictEqual(releaseType('stable', '0.18.0'), '');
  });
});
