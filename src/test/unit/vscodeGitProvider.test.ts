import * as assert from 'assert';

import { IGitRef } from '../../common/git/types';
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

interface RepoOptions {
  commits?: Record<string, object>;
  branches?: Record<string, object>;
  onGetRefs?: (query: object | undefined) => void;
  onGetBranch?: (name: string) => void;
}

function makeRepo(fsPath: string, refs: object[], headName?: string, options: RepoOptions = {}) {
  return {
    rootUri: { fsPath },
    state: {
      HEAD: headName ? { type: REF_TYPE_HEAD, name: headName } : undefined,
      refs,
    },
    getRefs: async (query?: object) => {
      options.onGetRefs?.(query);
      return refs;
    },
    getCommit: async (ref: string) => {
      const commit = options.commits?.[ref];
      if (!commit) {
        throw new Error(`commit not found: ${ref}`);
      }
      return commit;
    },
    getBranch: async (name: string) => {
      options.onGetBranch?.(name);
      const branch = options.branches?.[name];
      if (!branch) {
        throw new Error(`branch not found: ${name}`);
      }
      return branch;
    },
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

    it('requests refs sorted by committer date', async () => {
      const queries: Array<object | undefined> = [];
      const fakeApi = makeApi([
        makeRepo(
          '/repo',
          [{ type: REF_TYPE_HEAD, name: 'main', commit: 'abc' }],
          undefined,
          { onGetRefs: (query) => queries.push(query) }
        ),
      ]);
      const provider = new VscodeGitProvider(mockLogService, () => fakeApi as any);

      await provider.getRefsForRepo('/repo');

      assert.deepStrictEqual(queries, [{ sort: 'committerdate' }]);
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

  describe('getRefDetails', () => {
    const localRef = (over: Partial<IGitRef> = {}): IGitRef => ({
      name: 'main',
      fullName: 'main',
      hash: 'abc123',
      authorName: '',
      ...over,
    });

    it('enriches a local branch with commit details and ahead/behind', async () => {
      const fakeApi = makeApi([
        makeRepo('/repo', [], undefined, {
          commits: {
            abc123: {
              hash: 'abc123def',
              message: 'Fix login\n\nlonger body',
              authorName: 'John Doe',
              commitDate: new Date('2024-01-01T00:00:00Z'),
            },
          },
          branches: { main: { ahead: 2, behind: 1 } },
        }),
      ]);
      const provider = new VscodeGitProvider(mockLogService, () => fakeApi as any);

      const details = await provider.getRefDetails('/repo', localRef());

      assert.strictEqual(details.committerDate, '1704067200');
      assert.strictEqual(details.comment, 'Fix login');
      assert.strictEqual(details.authorName, 'John Doe');
      assert.strictEqual(details.hash, 'abc123d');
      assert.deepStrictEqual(details.parsedUpstreamTrack, [2, 1]);
    });

    it('does not call getBranch for a remote branch', async () => {
      const calls: string[] = [];
      const fakeApi = makeApi([
        makeRepo('/repo', [], undefined, {
          commits: { rem123: { hash: 'rem123aa', message: 'remote', authorName: 'A' } },
          onGetBranch: (name) => calls.push(name),
        }),
      ]);
      const provider = new VscodeGitProvider(mockLogService, () => fakeApi as any);

      const details = await provider.getRefDetails(
        '/repo',
        { name: 'main', fullName: 'origin/main', remote: 'origin', hash: 'rem123', authorName: '' }
      );

      assert.strictEqual(details.comment, 'remote');
      assert.strictEqual(details.parsedUpstreamTrack, undefined);
      assert.deepStrictEqual(calls, []);
    });

    it('resolves a tag by name and does not call getBranch', async () => {
      const calls: string[] = [];
      const fakeApi = makeApi([
        makeRepo('/repo', [], undefined, {
          commits: { 'v1.0.0': { hash: 'tag1234', message: 'release', authorName: 'A' } },
          onGetBranch: (name) => calls.push(name),
        }),
      ]);
      const provider = new VscodeGitProvider(mockLogService, () => fakeApi as any);

      const details = await provider.getRefDetails(
        '/repo',
        { name: 'v1.0.0', fullName: 'v1.0.0', isTag: true, hash: 'ignored', authorName: '' }
      );

      assert.strictEqual(details.comment, 'release');
      assert.strictEqual(details.parsedUpstreamTrack, undefined);
      assert.deepStrictEqual(calls, []);
    });

    it('returns ahead/behind even when getCommit fails', async () => {
      const fakeApi = makeApi([
        makeRepo('/repo', [], undefined, {
          commits: {},
          branches: { main: { ahead: 0, behind: 3 } },
        }),
      ]);
      const provider = new VscodeGitProvider(mockLogService, () => fakeApi as any);

      const details = await provider.getRefDetails('/repo', localRef());

      assert.strictEqual(details.comment, undefined);
      assert.deepStrictEqual(details.parsedUpstreamTrack, [0, 3]);
    });

    it('returns commit details even when getBranch fails', async () => {
      const fakeApi = makeApi([
        makeRepo('/repo', [], undefined, {
          commits: { abc123: { hash: 'abc123def', message: 'msg', authorName: 'A' } },
          branches: {},
        }),
      ]);
      const provider = new VscodeGitProvider(mockLogService, () => fakeApi as any);

      const details = await provider.getRefDetails('/repo', localRef());

      assert.strictEqual(details.comment, 'msg');
      assert.strictEqual(details.parsedUpstreamTrack, undefined);
    });

    it('omits parsedUpstreamTrack when ahead and behind are both undefined', async () => {
      const fakeApi = makeApi([
        makeRepo('/repo', [], undefined, {
          commits: { abc123: { hash: 'abc123def', message: 'msg', authorName: 'A' } },
          branches: { main: {} },
        }),
      ]);
      const provider = new VscodeGitProvider(mockLogService, () => fakeApi as any);

      const details = await provider.getRefDetails('/repo', localRef());

      assert.strictEqual(details.parsedUpstreamTrack, undefined);
    });

    it('returns an empty object when the repo path is not found', async () => {
      const fakeApi = makeApi([makeRepo('/other', [])]);
      const provider = new VscodeGitProvider(mockLogService, () => fakeApi as any);

      const details = await provider.getRefDetails('/repo', localRef());

      assert.deepStrictEqual(details, {});
    });
  });
});
