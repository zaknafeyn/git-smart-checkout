import * as assert from 'assert';
import * as path from 'path';

describe('verifyPublished', () => {
  let marketplaceHasVersion: (
    versions: Array<{ version: string; properties?: Array<{ key: string; value: string }> }>,
    version: string,
    expectPreRelease: boolean,
  ) => boolean;
  let pollUntil: (
    check: () => Promise<boolean>,
    opts?: { attempts?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> },
  ) => Promise<boolean>;

  before(async () => {
    const modulePath = path.join(__dirname, '..', '..', '..', 'scripts', 'verifyPublished.mjs');
    ({ marketplaceHasVersion, pollUntil } = await import(modulePath));
  });

  describe('marketplaceHasVersion', () => {
    const versions = [
      { version: '0.18.0', properties: [] },
      {
        version: '0.19.0',
        properties: [{ key: 'Microsoft.VisualStudio.Code.PreRelease', value: 'true' }],
      },
    ];

    it('returns false when the version is absent', () => {
      assert.strictEqual(marketplaceHasVersion(versions, '0.20.0', false), false);
    });

    it('returns true for a stable check when the version exists, regardless of properties', () => {
      assert.strictEqual(marketplaceHasVersion(versions, '0.18.0', false), true);
    });

    it('returns true only when the PreRelease marker is set for a pre-release check', () => {
      assert.strictEqual(marketplaceHasVersion(versions, '0.19.0', true), true);
      assert.strictEqual(marketplaceHasVersion(versions, '0.18.0', true), false);
    });
  });

  describe('pollUntil', () => {
    it('returns true as soon as the check passes, without sleeping again', async () => {
      let calls = 0;
      const sleeps: number[] = [];
      const result = await pollUntil(
        async () => {
          calls += 1;
          return calls === 2;
        },
        {
          attempts: 5,
          delayMs: 111,
          sleep: async (ms) => {
            sleeps.push(ms);
          },
        },
      );
      assert.strictEqual(result, true);
      assert.strictEqual(calls, 2);
      assert.deepStrictEqual(sleeps, [111]);
    });

    it('returns false after exhausting all attempts', async () => {
      let calls = 0;
      const result = await pollUntil(
        async () => {
          calls += 1;
          return false;
        },
        { attempts: 3, delayMs: 1, sleep: async () => {} },
      );
      assert.strictEqual(result, false);
      assert.strictEqual(calls, 3);
    });
  });
});
