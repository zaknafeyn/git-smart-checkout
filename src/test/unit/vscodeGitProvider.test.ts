import * as assert from 'assert';

import { VscodeGitProvider } from '../../common/git/vscodeGitProvider';

import { mockLogService } from '../e2e/helpers/mockLogService';

// ---------------------------------------------------------------------------
// Helpers to build fake VS Code Git API objects
// ---------------------------------------------------------------------------

const REF_TYPE_HEAD = 0;
const REF_TYPE_REMOTE_HEAD = 1;
const REF_TYPE_TAG = 2;

function makeApi(repos: ReturnType<typeof makeRepo>[]) {
  return {
    repositories: repos,
    getRepository: (uri: { fsPath: string }) =>
      repos.find((r) => r.rootUri.fsPath === uri.fsPath) ?? null,
  };
}

function makeRepo(fsPath: string, refs: object[], headName?: string) {
  return {
    rootUri: { fsPath },
    state: {
      HEAD: headName ? { type: REF_TYPE_HEAD, name: headName } : undefined,
      refs,
    },
    getRefs: async () => refs,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VscodeGitProvider', () => {
  describe('tryCreate', () => {
    it('returns undefined when the VS Code git extension is not available', () => {
      const provider = VscodeGitProvider.tryCreate(mockLogService, () => undefined);
      assert.strictEqual(provider, undefined);
    });

    it('returns a provider instance when the API is available', () => {
      const fakeApi = makeApi([makeRepo('/repo', [])]);
      const provider = VscodeGitProvider.tryCreate(mockLogService, () => fakeApi as any);
      assert.ok(provider instanceof VscodeGitProvider);
    });

    it('returns undefined when the apiLoader throws', () => {
      const provider = VscodeGitProvider.tryCreate(mockLogService, () => {
        throw new Error('activation failed');
      });
      assert.strictEqual(provider, undefined);
    });
  });

  describe('getRefsForRepo', () => {
    it('returns undefined when no repository matches the path', async () => {
      const fakeApi = makeApi([makeRepo('/other', [])]);
      const provider = new VscodeGitProvider(mockLogService, () => fakeApi as any);
      assert.strictEqual(await provider.getRefsForRepo('/repo'), undefined);
    });

    it('maps Head refs to local branches', async () => {
      const fakeApi = makeApi([
        makeRepo('/repo', [
          { type: REF_TYPE_HEAD, name: 'main', commit: 'abc123' },
          { type: REF_TYPE_HEAD, name: 'feature/foo', commit: 'def456' },
        ]),
      ]);
      const provider = new VscodeGitProvider(mockLogService, () => fakeApi as any);
      const refs = await provider.getRefsForRepo('/repo');

      assert.ok(refs);
      assert.strictEqual(refs.length, 2);

      const main = refs.find((r) => r.name === 'main');
      assert.ok(main);
      assert.strictEqual(main.fullName, 'main');
      assert.strictEqual(main.remote, undefined);
      assert.strictEqual(main.isTag, undefined);
      assert.strictEqual(main.hash, 'abc123');
    });

    it('maps RemoteHead refs to remote branches', async () => {
      const fakeApi = makeApi([
        makeRepo('/repo', [
          { type: REF_TYPE_REMOTE_HEAD, name: 'origin/main', commit: 'abc', remote: 'origin' },
          { type: REF_TYPE_REMOTE_HEAD, name: 'origin/feat/bar', commit: 'def', remote: 'origin' },
        ]),
      ]);
      const provider = new VscodeGitProvider(mockLogService, () => fakeApi as any);
      const refs = await provider.getRefsForRepo('/repo');

      assert.ok(refs);
      assert.strictEqual(refs.length, 2);

      const main = refs.find((r) => r.name === 'main');
      assert.ok(main);
      assert.strictEqual(main.fullName, 'origin/main');
      assert.strictEqual(main.remote, 'origin');

      const feat = refs.find((r) => r.name === 'feat/bar');
      assert.ok(feat);
      assert.strictEqual(feat.fullName, 'origin/feat/bar');
    });

    it('maps Tag refs with isTag=true', async () => {
      const fakeApi = makeApi([
        makeRepo('/repo', [
          { type: REF_TYPE_TAG, name: 'v1.0.0', commit: 'abc' },
        ]),
      ]);
      const provider = new VscodeGitProvider(mockLogService, () => fakeApi as any);
      const refs = await provider.getRefsForRepo('/repo');

      assert.ok(refs);
      assert.strictEqual(refs.length, 1);
      assert.strictEqual(refs[0].isTag, true);
      assert.strictEqual(refs[0].name, 'v1.0.0');
      assert.strictEqual(refs[0].fullName, 'v1.0.0');
    });

    it('filters out refs without a name and the HEAD sentinel', async () => {
      const fakeApi = makeApi([
        makeRepo('/repo', [
          { type: REF_TYPE_HEAD, name: undefined },
          { type: REF_TYPE_HEAD, name: 'HEAD' },
          { type: REF_TYPE_HEAD, name: 'main', commit: 'abc' },
        ]),
      ]);
      const provider = new VscodeGitProvider(mockLogService, () => fakeApi as any);
      const refs = await provider.getRefsForRepo('/repo');

      assert.ok(refs);
      assert.strictEqual(refs.length, 1);
      assert.strictEqual(refs[0].name, 'main');
    });

    it('filters out RemoteHead refs missing the remote field', async () => {
      const fakeApi = makeApi([
        makeRepo('/repo', [
          { type: REF_TYPE_REMOTE_HEAD, name: 'origin/main' /* no remote field */ },
        ]),
      ]);
      const provider = new VscodeGitProvider(mockLogService, () => fakeApi as any);
      const refs = await provider.getRefsForRepo('/repo');

      assert.ok(refs);
      assert.strictEqual(refs.length, 0);
    });

    it('picks the correct repository when multiple repos are present', async () => {
      const fakeApi = makeApi([
        makeRepo('/repoA', [{ type: REF_TYPE_HEAD, name: 'alpha', commit: '111' }]),
        makeRepo('/repoB', [{ type: REF_TYPE_HEAD, name: 'beta', commit: '222' }]),
      ]);
      const provider = new VscodeGitProvider(mockLogService, () => fakeApi as any);

      const refsA = await provider.getRefsForRepo('/repoA');
      assert.ok(refsA);
      assert.strictEqual(refsA[0].name, 'alpha');

      const refsB = await provider.getRefsForRepo('/repoB');
      assert.ok(refsB);
      assert.strictEqual(refsB[0].name, 'beta');
    });

    it('returns undefined when the API loader returns undefined', async () => {
      const provider = new VscodeGitProvider(mockLogService, () => undefined);
      assert.strictEqual(await provider.getRefsForRepo('/repo'), undefined);
    });
  });

  describe('getCurrentBranch', () => {
    it('returns the HEAD branch name', () => {
      const fakeApi = makeApi([makeRepo('/repo', [], 'main')]);
      const provider = new VscodeGitProvider(mockLogService, () => fakeApi as any);
      assert.strictEqual(provider.getCurrentBranch('/repo'), 'main');
    });

    it('returns undefined when HEAD is not set (detached HEAD)', () => {
      const fakeApi = makeApi([makeRepo('/repo', [])]);
      const provider = new VscodeGitProvider(mockLogService, () => fakeApi as any);
      assert.strictEqual(provider.getCurrentBranch('/repo'), undefined);
    });

    it('returns undefined when the repo path is not found', () => {
      const fakeApi = makeApi([makeRepo('/other', [], 'main')]);
      const provider = new VscodeGitProvider(mockLogService, () => fakeApi as any);
      assert.strictEqual(provider.getCurrentBranch('/repo'), undefined);
    });
  });
});
