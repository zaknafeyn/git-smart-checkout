import * as assert from 'assert';

import { IGitRef } from '../../common/git/types';
import { PreferredRefsRepo } from '../../configuration/extensionConfig';
import {
  cleanupMissingRefs,
  emptyPreferredRefs,
  getRepoPrefs,
  isRefPreferred,
  preferredOrderIndex,
  sortByPreferredOrder,
  togglePreferredRef,
} from '../../configuration/preferredRefs';

function local(name: string): IGitRef {
  return { name, fullName: name, authorName: '' };
}

function remote(name: string, remoteName = 'origin'): IGitRef {
  return { name, fullName: `${remoteName}/${name}`, remote: remoteName, authorName: '' };
}

function tag(name: string): IGitRef {
  return { name, fullName: name, isTag: true, authorName: '' };
}

describe('preferredRefs', () => {
  describe('getRepoPrefs', () => {
    it('returns an empty set for unknown repos', () => {
      assert.deepStrictEqual(getRepoPrefs(undefined, 'a'), emptyPreferredRefs());
      assert.deepStrictEqual(getRepoPrefs({}, 'a'), emptyPreferredRefs());
    });

    it('returns the stored prefs when present', () => {
      const prefs: PreferredRefsRepo = { locals: ['refs/heads/main'], remotes: [], tags: [] };
      assert.strictEqual(getRepoPrefs({ a: prefs }, 'a'), prefs);
    });
  });

  describe('isRefPreferred', () => {
    const prefs: PreferredRefsRepo = {
      locals: ['refs/heads/main'],
      remotes: ['refs/remotes/origin/feature'],
      tags: ['refs/tags/v1'],
    };

    it('matches locals, remotes and tags by full refname', () => {
      assert.strictEqual(isRefPreferred(prefs, local('main')), true);
      assert.strictEqual(isRefPreferred(prefs, remote('feature')), true);
      assert.strictEqual(isRefPreferred(prefs, tag('v1')), true);
    });

    it('does not cross-match a tag and a same-named branch', () => {
      const p: PreferredRefsRepo = { locals: ['refs/heads/v1'], remotes: [], tags: [] };
      assert.strictEqual(isRefPreferred(p, tag('v1')), false);
      assert.strictEqual(isRefPreferred(p, local('v1')), true);
    });

    it('returns false for non-preferred refs', () => {
      assert.strictEqual(isRefPreferred(prefs, local('other')), false);
    });
  });

  describe('togglePreferredRef', () => {
    it('does not mutate the input prefs', () => {
      const prefs = emptyPreferredRefs();
      const next = togglePreferredRef(prefs, local('main'), [local('main')]);
      assert.deepStrictEqual(prefs, emptyPreferredRefs());
      assert.deepStrictEqual(next.locals, ['refs/heads/main']);
    });

    it('toggles a local branch on and off', () => {
      const on = togglePreferredRef(emptyPreferredRefs(), local('main'), [local('main')]);
      assert.deepStrictEqual(on.locals, ['refs/heads/main']);
      const off = togglePreferredRef(on, local('main'), [local('main')]);
      assert.deepStrictEqual(off.locals, []);
    });

    it('toggles a tag independently', () => {
      const on = togglePreferredRef(emptyPreferredRefs(), tag('v1'), [tag('v1')]);
      assert.deepStrictEqual(on.tags, ['refs/tags/v1']);
      assert.deepStrictEqual(on.locals, []);
      assert.deepStrictEqual(on.remotes, []);
    });

    it('stars the matching remote when a local with a counterpart is starred', () => {
      const refs = [local('main'), remote('main')];
      const next = togglePreferredRef(emptyPreferredRefs(), local('main'), refs);
      assert.deepStrictEqual(next.locals, ['refs/heads/main']);
      assert.deepStrictEqual(next.remotes, ['refs/remotes/origin/main']);
    });

    it('stars the matching local when a remote with a counterpart is starred', () => {
      const refs = [local('main'), remote('main')];
      const next = togglePreferredRef(emptyPreferredRefs(), remote('main'), refs);
      assert.deepStrictEqual(next.remotes, ['refs/remotes/origin/main']);
      assert.deepStrictEqual(next.locals, ['refs/heads/main']);
    });

    it('does not create a local entry for a remote without a local counterpart', () => {
      const refs = [remote('only-remote')];
      const next = togglePreferredRef(emptyPreferredRefs(), remote('only-remote'), refs);
      assert.deepStrictEqual(next.remotes, ['refs/remotes/origin/only-remote']);
      assert.deepStrictEqual(next.locals, []);
    });

    it('unstarring a local also unstars its synced remotes', () => {
      const refs = [local('main'), remote('main')];
      const on = togglePreferredRef(emptyPreferredRefs(), local('main'), refs);
      const off = togglePreferredRef(on, local('main'), refs);
      assert.deepStrictEqual(off.locals, []);
      assert.deepStrictEqual(off.remotes, []);
    });

    it('does not duplicate a synced local that is already preferred', () => {
      const refs = [local('main'), remote('main')];
      // local already starred; starring the remote counterpart must not re-add the local
      const start: PreferredRefsRepo = { locals: ['refs/heads/main'], remotes: [], tags: [] };
      const next = togglePreferredRef(start, remote('main'), refs);
      assert.deepStrictEqual(next.locals, ['refs/heads/main']);
      assert.deepStrictEqual(next.remotes, ['refs/remotes/origin/main']);
    });
  });

  describe('cleanupMissingRefs', () => {
    it('reports no change when everything still exists', () => {
      const prefs: PreferredRefsRepo = {
        locals: ['refs/heads/main'],
        remotes: ['refs/remotes/origin/main'],
        tags: ['refs/tags/v1'],
      };
      const existing = new Set([
        'refs/heads/main',
        'refs/remotes/origin/main',
        'refs/tags/v1',
      ]);
      const { prefs: next, changed } = cleanupMissingRefs(prefs, existing);
      assert.strictEqual(changed, false);
      assert.deepStrictEqual(next, prefs);
    });

    it('drops entries whose refs no longer exist and flags the change', () => {
      const prefs: PreferredRefsRepo = {
        locals: ['refs/heads/main', 'refs/heads/gone'],
        remotes: ['refs/remotes/origin/gone'],
        tags: ['refs/tags/v1'],
      };
      const existing = new Set(['refs/heads/main', 'refs/tags/v1']);
      const { prefs: next, changed } = cleanupMissingRefs(prefs, existing);
      assert.strictEqual(changed, true);
      assert.deepStrictEqual(next, {
        locals: ['refs/heads/main'],
        remotes: [],
        tags: ['refs/tags/v1'],
      });
    });
  });

  describe('ordering', () => {
    const prefs: PreferredRefsRepo = {
      locals: ['refs/heads/b', 'refs/heads/a'],
      remotes: [],
      tags: [],
    };

    it('returns the star position, MAX for non-preferred', () => {
      assert.strictEqual(preferredOrderIndex(prefs, local('b')), 0);
      assert.strictEqual(preferredOrderIndex(prefs, local('a')), 1);
      assert.strictEqual(preferredOrderIndex(prefs, local('c')), Number.MAX_SAFE_INTEGER);
    });

    it('sorts by star order, keeping original order for ties', () => {
      const sorted = sortByPreferredOrder([local('a'), local('b'), local('c')], prefs);
      assert.deepStrictEqual(
        sorted.map((r) => r.name),
        ['b', 'a', 'c']
      );
    });

    it('is a stable no-op when nothing is preferred', () => {
      const refs = [local('x'), local('y'), local('z')];
      const sorted = sortByPreferredOrder(refs, emptyPreferredRefs());
      assert.deepStrictEqual(
        sorted.map((r) => r.name),
        ['x', 'y', 'z']
      );
    });
  });
});
