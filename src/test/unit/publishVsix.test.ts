import * as assert from 'assert';
import * as path from 'path';

describe('publishVsix', () => {
  let classifyFailure: (output: string) => 'already-published' | 'transient' | 'fatal';
  let backoffDelayMs: (attempt: number) => number;
  let publishToRegistry: (opts: {
    label: string;
    run: () => Promise<{ ok: boolean; output: string }>;
    attempts?: number;
    sleep?: (ms: number) => Promise<void>;
  }) => Promise<{ label: string; status: string; attempt: number; output?: string }>;

  before(async () => {
    const modulePath = path.join(__dirname, '..', '..', '..', 'scripts', 'publishVsix.mjs');
    ({ classifyFailure, backoffDelayMs, publishToRegistry } = await import(modulePath));
  });

  describe('classifyFailure', () => {
    it('classifies a Marketplace gallery timeout as transient', () => {
      assert.strictEqual(classifyFailure('::error::Request timeout: /_apis/gallery'), 'transient');
    });

    it('classifies connection resets and 5xx as transient', () => {
      assert.strictEqual(classifyFailure('Error: connect ECONNRESET'), 'transient');
      assert.strictEqual(classifyFailure('Server responded with 503 Service Unavailable'), 'transient');
    });

    it('classifies "already published" as already-published', () => {
      assert.strictEqual(classifyFailure('Error: Extension already exists.'), 'already-published');
      assert.strictEqual(
        classifyFailure('Extension \'vradchuk.git-smart-checkout\' version 0.19.0 is already published.'),
        'already-published',
      );
    });

    it('classifies an unrecognized error as fatal', () => {
      assert.strictEqual(classifyFailure('Error: Invalid Personal Access Token'), 'fatal');
    });
  });

  describe('backoffDelayMs', () => {
    it('grows exponentially starting at 1s', () => {
      assert.strictEqual(backoffDelayMs(1), 1000);
      assert.strictEqual(backoffDelayMs(2), 4000);
      assert.strictEqual(backoffDelayMs(3), 16000);
    });
  });

  describe('publishToRegistry', () => {
    it('succeeds immediately when the run succeeds on the first attempt', async () => {
      let calls = 0;
      const result = await publishToRegistry({
        label: 'Test Registry',
        run: async () => {
          calls += 1;
          return { ok: true, output: '' };
        },
      });
      assert.strictEqual(result.status, 'published');
      assert.strictEqual(result.attempt, 1);
      assert.strictEqual(calls, 1);
    });

    it('retries transient failures and eventually succeeds', async () => {
      let calls = 0;
      const sleeps: number[] = [];
      const result = await publishToRegistry({
        label: 'Test Registry',
        run: async () => {
          calls += 1;
          if (calls < 3) {
            return { ok: false, output: 'Request timeout: /_apis/gallery' };
          }
          return { ok: true, output: '' };
        },
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      });
      assert.strictEqual(result.status, 'published');
      assert.strictEqual(calls, 3);
      assert.deepStrictEqual(sleeps, [1000, 4000]);
    });

    it('treats "already published" as a terminal success without retrying further', async () => {
      let calls = 0;
      const result = await publishToRegistry({
        label: 'Test Registry',
        run: async () => {
          calls += 1;
          return { ok: false, output: 'Error: version is already published.' };
        },
      });
      assert.strictEqual(result.status, 'already-published');
      assert.strictEqual(calls, 1);
    });

    it('fails fast on a fatal error without retrying', async () => {
      let calls = 0;
      const result = await publishToRegistry({
        label: 'Test Registry',
        run: async () => {
          calls += 1;
          return { ok: false, output: 'Error: Invalid Personal Access Token' };
        },
      });
      assert.strictEqual(result.status, 'failed');
      assert.strictEqual(calls, 1);
    });

    it('gives up after exhausting attempts on repeated transient failures', async () => {
      let calls = 0;
      const result = await publishToRegistry({
        label: 'Test Registry',
        attempts: 3,
        sleep: async () => {},
        run: async () => {
          calls += 1;
          return { ok: false, output: 'ETIMEDOUT' };
        },
      });
      assert.strictEqual(result.status, 'failed');
      assert.strictEqual(calls, 3);
    });
  });
});
